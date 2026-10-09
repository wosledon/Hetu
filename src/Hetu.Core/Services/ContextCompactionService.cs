using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Context;
using Microsoft.Extensions.Logging;
namespace Hetu.Core.Services;

/// <summary>
/// 会话上下文管理：统计上下文占用（系统提示 / 历史 / 摘要）并在超限或用户执行 /compress 时，
/// 用当前大模型把较早的历史压缩成一段摘要，摘要只影响后续 LLM 上下文，不改动原始消息。
/// </summary>
public class ContextCompactionService
{
    /// <summary>自动压缩触发阈值：占用达到窗口的该比例时先压缩再发送</summary>
    private const double AutoCompactRatio = 0.8;

    /// <summary>压缩时保留最近的消息条数（不参与摘要）</summary>
    private const int DefaultKeepRecent = 6;

    /// <summary>送进摘要模型的最大字符数</summary>
    private const int MaxTranscriptChars = 60_000;

    /// <summary>摘要失败（空返回/被截断）时的最大尝试次数</summary>
    private const int MaxSummaryAttempts = 3;

    private const string SummarySystemPrompt =
        "你是上下文压缩器。把给定的对话/会话记录压缩成一份结构化交接摘要，供后续轮次直接使用。\n" +
        "必须保留：用户目标与诉求、已达成的结论与决定、涉及的文件/命令/路径、关键代码与配置片段要点、未完成的待办与下一步、约束与禁忌。\n" +
        "丢弃：寒暄、重复内容、已被覆盖的中间过程、无信息量的日志与噪声。\n" +
        "输出中文 Markdown，按小节组织：## 目标 / ## 关键结论与决定 / ## 涉及文件与命令 / ## 待办与下一步 / ## 约束。";

    private readonly IUnitOfWork _unitOfWork;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly ILogger<ContextCompactionService> _logger;

    public ContextCompactionService(
        IUnitOfWork unitOfWork,
        ILLMProviderFactory llmProviderFactory,
        ILogger<ContextCompactionService> logger)
    {
        _unitOfWork = unitOfWork;
        _llmProviderFactory = llmProviderFactory;
        _logger = logger;
    }

    // ---------- 上下文占用 ----------

    public async Task<ApiResponse<ContextUsageDto>> GetChatUsageAsync(Guid topicId, int? contextWindow, CancellationToken ct = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, ct);
        if (topic == null) return ApiResponse<ContextUsageDto>.Fail("话题不存在");

        var messages = (await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId, ct))
            .OrderBy(m => m.CreatedAt).ToList();
        var window = ResolveWindow(contextWindow, await ResolveModelContextWindowAsync(topic.ModelId, ct));

        return ApiResponse<ContextUsageDto>.Ok(BuildUsage(
            window,
            messages.Select(m => (m.Id, m.CreatedAt, Text: m.Content ?? string.Empty, PromptTokens: m.InputTokens ?? m.TokensUsed)).ToList(),
            topic.ContextSummary,
            topic.ContextSummaryThroughMessageId,
            systemFallbackTokens: 1500));
    }

    public async Task<ApiResponse<ContextUsageDto>> GetWorkUsageAsync(Guid sessionId, int? contextWindow, CancellationToken ct = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(sessionId, ct);
        if (session == null) return ApiResponse<ContextUsageDto>.Fail("会话不存在");

        var messages = (await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == sessionId && m.Type == "text", ct))
            .OrderBy(m => m.CreatedAt).ToList();
        messages = messages.Where(m => m.Role is "user" or "assistant").ToList();
        var window = ResolveWindow(contextWindow, await ResolveModelContextWindowAsync(session.ModelId, ct));

        return ApiResponse<ContextUsageDto>.Ok(BuildUsage(
            window,
            messages.Select(m => (m.Id, m.CreatedAt, Text: m.Content ?? string.Empty, m.PromptTokens)).ToList(),
            session.ContextSummary,
            session.ContextSummaryThroughMessageId,
            systemFallbackTokens: 3500));
    }

    private async Task<int?> ResolveModelContextWindowAsync(Guid? modelId, CancellationToken ct)
    {
        if (modelId is null) return null;
        var model = await _unitOfWork.AiModels.GetByIdAsync(modelId.Value, ct);
        return model?.ContextWindow;
    }

    private static int ResolveWindow(int? overrideWindow, int? modelWindow)
        => overrideWindow is > 0 ? overrideWindow.Value : modelWindow is > 0 ? modelWindow.Value : 128_000;

    private static ContextUsageDto BuildUsage(
        int window,
        List<(Guid Id, DateTimeOffset CreatedAt, string Text, int? PromptTokens)> messages,
        string? summary,
        Guid? throughId,
        int systemFallbackTokens)
    {
        var summarized = CountSummarized(messages, throughId);
        var historyChars = messages.Skip(summarized).Sum(m => (long)m.Text.Length);
        var summaryChars = summary?.Length ?? 0;

        var historyTokens = LlmTokenEstimator.Estimate(messages.Skip(summarized).Select(m => m.Text));
        var summaryTokens = LlmTokenEstimator.Estimate(summary);

        // 系统提示与工具说明无法直接量出：用上一轮真实 prompt tokens 减去当时随上下文发送的历史，
        // 反推出「系统提示 + 工具」的固定开销；拿不到真实用量时用经验值。
        var usageIndex = messages.FindLastIndex(m => m.PromptTokens is > 0);
        var systemTokens = systemFallbackTokens;
        if (usageIndex >= 0)
        {
            var promptTokens = messages[usageIndex].PromptTokens!.Value;
            // 那一轮发送的历史：该消息之前的全部消息（压缩覆盖部分若当时已存在，则计入摘要而非历史）
            var historyThen = LlmTokenEstimator.Estimate(messages.Take(usageIndex).Select(m => m.Text));
            var summaryThen = summarized > 0 && usageIndex >= summarized ? summaryTokens : 0;
            systemTokens = Math.Max(0, promptTokens - historyThen - summaryThen);
        }

        // 已用 = 当前上下文（系统提示 + 摘要 + 未被压缩的历史），压缩后立刻下降
        var used = systemTokens + summaryTokens + historyTokens;

        return new ContextUsageDto
        {
            Window = window,
            Used = used,
            HasSummary = summaryChars > 0,
            SummarizedMessages = summarized,
            Parts =
            [
                new ContextUsagePartDto { Key = "system", Label = "系统提示与工具", Tokens = systemTokens, Chars = systemTokens * LlmTokenEstimator.CharsPerToken, Estimated = usageIndex < 0 },
                new ContextUsagePartDto { Key = "history", Label = "历史消息", Tokens = historyTokens, Chars = historyChars },
                new ContextUsagePartDto { Key = "summary", Label = "上下文摘要", Tokens = summaryTokens, Chars = summaryChars },
            ],
        };
    }

    /// <summary>摘要覆盖的消息条数（摘要覆盖到最后一条文本消息 Id 为止）</summary>
    private static int CountSummarized(List<(Guid Id, DateTimeOffset CreatedAt, string Text, int? PromptTokens)> messages, Guid? throughId)
    {
        if (throughId is null || throughId == Guid.Empty) return 0;
        var index = messages.FindIndex(m => m.Id == throughId.Value);
        return index < 0 ? 0 : index + 1;
    }

    // ---------- 压缩 ----------

    public Task<ApiResponse<CompactContextResultDto>> CompactChatAsync(Guid topicId, CompactContextRequest request, CancellationToken ct = default)
        => CompactAsync(
            topicId,
            request,
            // 读取并回写：话题摘要字段
            load: async id => await _unitOfWork.ChatTopics.GetByIdAsync(id, ct),
            messages: async id => (await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == id, ct))
                .OrderBy(m => m.CreatedAt)
                .Select(m => (m.Id, m.Role, Text: m.Content ?? string.Empty))
                .ToList(),
            save: async (topic, summary, throughId) =>
            {
                topic.ContextSummary = summary;
                topic.ContextSummaryThroughMessageId = throughId;
                await _unitOfWork.ChatTopics.UpdateAsync(topic, ct);
                await _unitOfWork.SaveChangesAsync(ct);
            },
            ct);

    public Task<ApiResponse<CompactContextResultDto>> CompactWorkAsync(Guid sessionId, CompactContextRequest request, CancellationToken ct = default)
        => CompactAsync(
            sessionId,
            request,
            load: async id => await _unitOfWork.WorkSessions.GetByIdAsync(id, ct),
            messages: async id => (await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == id && m.Type == "text", ct))
                .Where(m => m.Role is "user" or "assistant")
                .OrderBy(m => m.CreatedAt)
                .Select(m => (m.Id, m.Role, Text: m.Content ?? string.Empty))
                .ToList(),
            save: async (session, summary, throughId) =>
            {
                session.ContextSummary = summary;
                session.ContextSummaryThroughMessageId = throughId;
                await _unitOfWork.WorkSessions.UpdateAsync(session, ct);
                await _unitOfWork.SaveChangesAsync(ct);
            },
            ct);

    private async Task<ApiResponse<CompactContextResultDto>> CompactAsync<T>(
        Guid id,
        CompactContextRequest request,
        Func<Guid, Task<T?>> load,
        Func<Guid, Task<List<(Guid Id, string Role, string Text)>>> messages,
        Func<T, string, Guid, Task> save,
        CancellationToken ct) where T : class
    {
        var entity = await load(id);
        if (entity == null) return ApiResponse<CompactContextResultDto>.Fail("会话不存在");

        var throughId = ReadThroughId(entity);
        var all = await messages(id);
        var start = throughId is null ? 0 : all.FindIndex(m => m.Id == throughId.Value) + 1;
        if (start < 0) start = 0;

        var pending = all.Skip(start).ToList();
        var keepRecent = Math.Max(0, request.KeepRecent <= 0 ? DefaultKeepRecent : request.KeepRecent);
        var toSummarize = pending.Count > keepRecent ? pending.Take(pending.Count - keepRecent).ToList() : [];
        if (toSummarize.Count == 0)
        {
            return ApiResponse<CompactContextResultDto>.Fail($"当前没有可压缩的历史（至少需要 {keepRecent + 1} 条文本消息）");
        }

        // 摘要模型偶发截断/空返回：重试若干次，取第一个通过长度校验的结果
        var inputChars = toSummarize.Sum(m => m.Text.Length);
        var minChars = inputChars > 1200 ? Math.Min(200, inputChars / 10) : 1;
        string? summary = null;
        for (var attempt = 1; attempt <= MaxSummaryAttempts && summary == null; attempt++)
        {
            var candidate = await SummarizeAsync(toSummarize, ReadSummary(entity), request.ModelId, ct);
            if (string.IsNullOrWhiteSpace(candidate))
            {
                _logger.LogWarning("[Context] 压缩第 {Attempt}/{Max} 次未返回内容", attempt, MaxSummaryAttempts);
                continue;
            }
            if (candidate.Length < minChars)
            {
                _logger.LogWarning("[Context] 压缩第 {Attempt}/{Max} 次摘要过短（{Len} 字符 / 输入 {Input} 字符），重试",
                    attempt, MaxSummaryAttempts, candidate.Length, inputChars);
                continue;
            }
            summary = candidate;
        }
        if (summary == null) return ApiResponse<CompactContextResultDto>.Fail("压缩失败：模型多次返回异常结果，历史保持不变");

        var lastId = toSummarize[^1].Id;
        await save(entity, summary, lastId);

        var beforeTokens = (long)LlmTokenEstimator.Estimate(toSummarize.Select(m => m.Text)) + LlmTokenEstimator.Estimate(ReadSummary(entity));
        var afterTokens = (long)LlmTokenEstimator.Estimate(summary);
        _logger.LogInformation(
            "[Context] 压缩完成：{Count} 条消息 → {SummaryChars} 字符摘要（约 {Before} → {After} tokens）",
            toSummarize.Count, summary.Length, beforeTokens, afterTokens);

        return ApiResponse<CompactContextResultDto>.Ok(new CompactContextResultDto
        {
            MessageCount = toSummarize.Count,
            SummaryChars = summary.Length,
            BeforeTokens = beforeTokens,
            AfterTokens = afterTokens,
            Summary = summary,
        });
    }

    /// <summary>超限自动压缩：占用达到窗口 80% 时先压缩，返回摘要文本；未触发返回 null</summary>
    public async Task<string?> TryAutoCompactChatAsync(Guid topicId, int? contextWindow, CancellationToken ct = default)
    {
        var usage = (await GetChatUsageAsync(topicId, contextWindow, ct)).Data;
        if (usage == null || usage.Used < usage.Window * AutoCompactRatio) return null;
        var result = await CompactChatAsync(topicId, new CompactContextRequest { ContextWindow = contextWindow }, ct);
        return result.Success ? result.Data?.Summary : null;
    }

    public async Task<string?> TryAutoCompactWorkAsync(Guid sessionId, int? contextWindow, CancellationToken ct = default)
    {
        var usage = (await GetWorkUsageAsync(sessionId, contextWindow, ct)).Data;
        if (usage == null || usage.Used < usage.Window * AutoCompactRatio) return null;
        var result = await CompactWorkAsync(sessionId, new CompactContextRequest { ContextWindow = contextWindow }, ct);
        return result.Success ? result.Data?.Summary : null;
    }

    private async Task<string?> SummarizeAsync(
        List<(Guid Id, string Role, string Text)> messages,
        string? previousSummary,
        Guid? modelId,
        CancellationToken ct)
    {
        var transcript = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(previousSummary))
        {
            transcript.AppendLine("【此前的摘要】");
            transcript.AppendLine(previousSummary);
            transcript.AppendLine();
        }
        foreach (var m in messages)
        {
            transcript.Append(m.Role == "user" ? "用户: " : "助手: ");
            transcript.AppendLine(m.Text);
        }

        var text = transcript.ToString();
        if (text.Length > MaxTranscriptChars) text = text[^MaxTranscriptChars..];

        try
        {
            var provider = modelId is { } id
                ? await _llmProviderFactory.CreateProviderAsync(id, ct)
                : await _llmProviderFactory.CreateChatProviderAsync(ct);
            if (provider == null) return null;

            var summary = await provider.ChatAsync(
                [new LlmChatMessage { Role = "user", Content = text }],
                new ChatOptions { ModelId = string.Empty, SystemPrompt = SummarySystemPrompt, MaxTokens = 2048 },
                ct);
            return string.IsNullOrWhiteSpace(summary) ? null : summary.Trim();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Context] 上下文压缩失败");
            return null;
        }
    }

    private static string? ReadSummary<T>(T entity) => entity switch
    {
        ChatTopic t => t.ContextSummary,
        WorkSession s => s.ContextSummary,
        _ => null,
    };

    private static Guid? ReadThroughId<T>(T entity) => entity switch
    {
        ChatTopic t => t.ContextSummaryThroughMessageId,
        WorkSession s => s.ContextSummaryThroughMessageId,
        _ => null,
    };
}
