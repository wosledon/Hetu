using System.Text.Json;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 非 Agent 的文本生成入口：NoteAI / Wiki / Graph / 压缩 / 查询改写等轻量任务统一走 MAF Agent，
/// 避免再维护一套 ILLMProvider HTTP 实现。
/// </summary>
public interface ITextGenerationClient
{
    /// <summary>解析场景默认模型；未配置/不可用时返回 null。</summary>
    Task<Guid?> ResolveScenarioModelAsync(string scenario, CancellationToken cancellationToken = default);

    /// <summary>解析 completion 用途默认模型；未配置/不可用时返回 null。</summary>
    Task<Guid?> ResolveCompletionModelAsync(CancellationToken cancellationToken = default);

    /// <summary>指定模型（null 表示默认对话模型）是否可用。</summary>
    Task<bool> IsAvailableAsync(Guid? modelId, CancellationToken cancellationToken = default);

    Task<LlmChatResult> ChatWithUsageAsync(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        CancellationToken cancellationToken = default);

    async Task<string> ChatAsync(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        CancellationToken cancellationToken = default)
        => (await ChatWithUsageAsync(modelId, messages, options, cancellationToken)).Content;

    IAsyncEnumerable<string> ChatStreamAsync(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        CancellationToken cancellationToken = default);

    Task<string> CompleteAsync(
        Guid? modelId,
        string prompt,
        CompletionOptions options,
        CancellationToken cancellationToken = default)
        => ChatAsync(
            modelId,
            [new LlmChatMessage { Role = "user", Content = prompt }],
            new ChatOptions { SystemPrompt = options.SystemPrompt, Temperature = options.Temperature, MaxTokens = options.MaxTokens },
            cancellationToken);
}