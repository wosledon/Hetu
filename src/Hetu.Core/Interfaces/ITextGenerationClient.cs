using System.Text.Json;
using Hetu.Core.Utilities;

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

    /// <summary>结构化 JSON 输出：Provider 支持时使用 JSON Schema，返回原始 JSON 与用量。</summary>
    Task<LlmChatResult> ChatJsonWithUsageAsync<T>(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        JsonSerializerOptions? jsonSerializerOptions = null,
        CancellationToken cancellationToken = default) where T : class;

    /// <summary>结构化 JSON 输出并反序列化；解析失败时回退到 LlmJsonExtractor 的宽松解析。</summary>
    async Task<T?> GenerateJsonAsync<T>(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        JsonSerializerOptions? jsonSerializerOptions = null,
        CancellationToken cancellationToken = default) where T : class
    {
        var result = await ChatJsonWithUsageAsync<T>(
            modelId, messages, options, jsonSerializerOptions, cancellationToken);
        if (string.IsNullOrWhiteSpace(result.Content)) return default;

        try
        {
            return JsonSerializer.Deserialize<T>(result.Content, jsonSerializerOptions ?? JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            return LlmJsonExtractor.Deserialize<T>(result.Content);
        }
    }

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