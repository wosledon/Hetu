using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>LLM 调用来源。新增调用路径时在此追加，用量统计页按此拆分。</summary>
public static class LlmUsageSources
{
    public const string Chat = "chat";
    public const string Work = "work";
    public const string Kanban = "kanban";
    public const string Workflow = "workflow";
    public const string Wiki = "wiki";
    public const string NoteAi = "note-ai";
    public const string Skill = "skill";
    public const string Graph = "graph";
    public const string Search = "search";
    public const string Scheduled = "scheduled";
    public const string Proxy = "proxy";
    /// <summary>上下文压缩 / 摘要：不属于任何业务页面，但同样计费，单独成源便于定位开销</summary>
    public const string Compression = "compression";
}

/// <summary>
/// 请求类型：区分同一来源下的不同调用目的。Agent 迭代是主请求，
/// 压缩 / 摘要 / 子 Agent 等辅助请求同样计费，必须能在明细里分辨出来。
/// </summary>
public static class LlmUsageRequestKinds
{
    public const string Agent = "agent";
    public const string SubAgent = "subagent";
    public const string Compression = "compression";
    public const string Compaction = "compaction";
    public const string Summarize = "summarize";
    public const string Classify = "classify";
    public const string Memory = "memory";
}

/// <summary>一条待记录的 LLM 请求。</summary>
public sealed class LlmUsageRecord
{
    public required string Source { get; init; }
    public Guid? RefId { get; init; }
    public Guid? TurnId { get; init; }
    public int? Iteration { get; init; }
    public string RequestKind { get; init; } = LlmUsageRequestKinds.Agent;
    public Guid? ModelId { get; init; }
    public int? InputTokens { get; init; }
    public int? CompressedTokens { get; init; }
    public int? PromptTokens { get; init; }
    public int? OutputTokens { get; init; }
    public int? TokensUsed { get; init; }
    public int? CachedTokens { get; init; }
    public int? CacheCreationTokens { get; init; }
    public int? LatencyMs { get; init; }
    public string? FinishReason { get; init; }
    public int? ToolCallCount { get; init; }
    public string? ContentPreview { get; init; }
}

/// <summary>
/// 统一用量记录器。所有 LLM 调用路径都通过它落一条 <see cref="LlmUsageLog"/>（一行 = 一次请求），
/// 使用量统计覆盖全部来源，而不是只有对话页。
/// </summary>
public interface ILlmUsageRecorder
{
    Task RecordAsync(LlmUsageRecord record, CancellationToken ct = default);

    /// <summary>
    /// 按 Provider 上报的用量记录一次请求。Provider 未上报用量时仍落库（输出/总计留空），
    /// 因为请求确实发生了；只有连输入估算都没有时才跳过。
    /// </summary>
    Task RecordAsync(
        string source,
        LlmUsage? usage,
        Guid? refId = null,
        Guid? modelId = null,
        int? inputTokens = null,
        int? compressedTokens = null,
        int? latencyMs = null,
        string? contentPreview = null,
        Guid? turnId = null,
        int? iteration = null,
        string requestKind = LlmUsageRequestKinds.Agent,
        string? finishReason = null,
        int? toolCallCount = null,
        CancellationToken ct = default);
}

/// <summary>
/// 用量记录器实现。失败只记日志，绝不影响主业务流程。
/// </summary>
public class LlmUsageRecorder : ILlmUsageRecorder
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<LlmUsageRecorder> _logger;
    private Guid? _defaultChatModelId;
    private bool _defaultModelResolved;

    public LlmUsageRecorder(IUnitOfWork unitOfWork, ILogger<LlmUsageRecorder> logger)
    {
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public Task RecordAsync(LlmUsageRecord record, CancellationToken ct = default) => SaveAsync(record, ct);

    public async Task RecordAsync(
        string source,
        LlmUsage? usage,
        Guid? refId = null,
        Guid? modelId = null,
        int? inputTokens = null,
        int? compressedTokens = null,
        int? latencyMs = null,
        string? contentPreview = null,
        Guid? turnId = null,
        int? iteration = null,
        string requestKind = LlmUsageRequestKinds.Agent,
        string? finishReason = null,
        int? toolCallCount = null,
        CancellationToken ct = default)
    {
        // 既没有 Provider 用量也没有输入估算：这条记录没有任何信息量，跳过
        if (usage == null && inputTokens == null) return;

        await SaveAsync(new LlmUsageRecord
        {
            Source = source,
            RefId = refId,
            TurnId = turnId,
            Iteration = iteration,
            RequestKind = requestKind,
            ModelId = modelId,
            InputTokens = inputTokens ?? usage?.PromptTokens,
            CompressedTokens = compressedTokens,
            // Provider 报了用量就照实记（含 0：0 命中是真实的 0%，与「没上报」要能区分）
            PromptTokens = usage?.PromptTokens,
            OutputTokens = usage?.CompletionTokens,
            TokensUsed = ResolveTotal(usage),
            CachedTokens = usage?.CachedTokens,
            CacheCreationTokens = usage is { CacheCreationTokens: > 0 } ? usage.CacheCreationTokens : null,
            LatencyMs = latencyMs,
            FinishReason = finishReason,
            ToolCallCount = toolCallCount,
            ContentPreview = Truncate(contentPreview),
        }, ct);
    }

    /// <summary>总计以 Provider 上报为准；只报了输入/输出没报总计时自行相加，避免总计列空着</summary>
    private static int? ResolveTotal(LlmUsage? usage)
    {
        if (usage == null) return null;
        if (usage.TotalTokens > 0) return usage.TotalTokens;
        var sum = usage.PromptTokens + usage.CompletionTokens;
        return sum > 0 ? sum : null;
    }

    private async Task SaveAsync(LlmUsageRecord record, CancellationToken ct)
    {
        try
        {
            var now = DateTimeOffset.UtcNow;
            await _unitOfWork.LlmUsageLogs.AddAsync(new LlmUsageLog
            {
                Id = Guid.NewGuid(),
                Source = record.Source,
                RefId = record.RefId,
                TurnId = record.TurnId,
                Iteration = record.Iteration,
                RequestKind = record.RequestKind,
                ModelId = await ResolveModelIdAsync(record.ModelId, ct),
                InputTokens = record.InputTokens,
                CompressedTokens = record.CompressedTokens,
                PromptTokens = record.PromptTokens,
                OutputTokens = record.OutputTokens,
                TokensUsed = record.TokensUsed,
                CachedTokens = record.CachedTokens,
                CacheCreationTokens = record.CacheCreationTokens,
                LatencyMs = record.LatencyMs,
                FinishReason = record.FinishReason,
                ToolCallCount = record.ToolCallCount,
                ContentPreview = record.ContentPreview,
                CreatedAt = now,
                UpdatedAt = now,
            }, ct);
            // 必须显式提交：调用方（对话流等）此后可能不再 SaveChanges，否则这条日志会随作用域释放丢掉
            await _unitOfWork.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "记录 LLM 用量失败 source={Source}", record.Source);
        }
    }

    /// <summary>
    /// 调用方没指定模型时补上默认对话模型：这些路径（技能 / 定时任务 / 查询改写 / 上下文压缩）
    /// 走的都是 CreateChatProviderAsync，不补的话明细里模型列只能显示「默认模型」。
    /// 作用域内只查一次。
    /// </summary>
    private async Task<Guid?> ResolveModelIdAsync(Guid? modelId, CancellationToken ct)
    {
        if (modelId.HasValue) return modelId;
        if (!_defaultModelResolved)
        {
            _defaultChatModelId = (await _unitOfWork.AiModels.GetDefaultByPurposeAsync("chat", ct))?.Id;
            _defaultModelResolved = true;
        }
        return _defaultChatModelId;
    }

    private static string? Truncate(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        return text.Length <= 80 ? text : text[..80] + "...";
    }
}
