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
    public const string Organize = "organize";
    public const string Skill = "skill";
    public const string Graph = "graph";
    public const string Search = "search";
    public const string Scheduled = "scheduled";
    public const string Proxy = "proxy";
}

/// <summary>一条待记录的 LLM 调用。</summary>
public sealed class LlmUsageRecord
{
    public required string Source { get; init; }
    public Guid? RefId { get; init; }
    public Guid? ModelId { get; init; }
    public int? InputTokens { get; init; }
    public int? CompressedTokens { get; init; }
    public int? OutputTokens { get; init; }
    public int? TokensUsed { get; init; }
    public int? CachedTokens { get; init; }
    public int? LatencyMs { get; init; }
    public string? ContentPreview { get; init; }
}

/// <summary>
/// 统一用量记录器。所有 LLM 调用路径都通过它落一条 <see cref="LlmUsageLog"/>，
/// 使用量统计覆盖全部来源，而不是只有对话页。
/// </summary>
public interface ILlmUsageRecorder
{
    Task RecordAsync(LlmUsageRecord record, CancellationToken ct = default);

    /// <summary>按 Provider 上报的用量记录（未上报用量时不落库）</summary>
    Task RecordAsync(
        string source,
        LlmUsage? usage,
        Guid? refId = null,
        Guid? modelId = null,
        int? inputTokens = null,
        int? compressedTokens = null,
        int? latencyMs = null,
        string? contentPreview = null,
        CancellationToken ct = default);
}

/// <summary>
/// 用量记录器实现。失败只记日志，绝不影响主业务流程。
/// </summary>
public class LlmUsageRecorder : ILlmUsageRecorder
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<LlmUsageRecorder> _logger;

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
        CancellationToken ct = default)
    {
        // Provider 未上报用量、也没有估算输入时无意义，跳过
        if (usage == null && inputTokens == null) return;

        var total = usage?.TotalTokens;
        if (total is null or 0 && inputTokens is null && usage?.PromptTokens is null or 0)
            return;

        await SaveAsync(new LlmUsageRecord
        {
            Source = source,
            RefId = refId,
            ModelId = modelId,
            InputTokens = inputTokens ?? usage?.PromptTokens,
            CompressedTokens = compressedTokens,
            OutputTokens = usage?.CompletionTokens,
            TokensUsed = total ?? usage?.PromptTokens,
            CachedTokens = usage?.CachedTokens,
            LatencyMs = latencyMs,
            ContentPreview = Truncate(contentPreview),
        }, ct);
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
                ModelId = record.ModelId,
                InputTokens = record.InputTokens,
                CompressedTokens = record.CompressedTokens,
                OutputTokens = record.OutputTokens,
                TokensUsed = record.TokensUsed,
                CachedTokens = record.CachedTokens,
                LatencyMs = record.LatencyMs,
                ContentPreview = record.ContentPreview,
                CreatedAt = now,
                UpdatedAt = now,
            }, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "记录 LLM 用量失败 source={Source}", record.Source);
        }
    }

    private static string? Truncate(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        return text.Length <= 80 ? text : text[..80] + "...";
    }
}
