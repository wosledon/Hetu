namespace Hetu.Core.Interfaces;

/// <summary>把一段对话压成交接摘要；用于 MAF 历史压缩与自动压缩。</summary>
public interface IContextCompactor
{
    Task<string?> SummarizeTurnAsync(
        IReadOnlyList<LlmChatMessage> messages,
        Guid? modelId,
        CancellationToken ct = default);
}