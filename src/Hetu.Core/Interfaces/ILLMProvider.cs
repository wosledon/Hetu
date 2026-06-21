

namespace Hetu.Core.Interfaces;

public class LlmContentPart
{
    public string Type { get; set; } = "text";
    public string? Text { get; set; }
    public string? ImageUrl { get; set; }
    public string? MediaType { get; set; }
}

public class LlmChatMessage
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    /// <summary>
    /// 多模态内容（文本 + 图片）。当有图片时，LLM Provider 会使用此字段而非 Content。
    /// </summary>
    public List<LlmContentPart>? ContentParts { get; set; }
}

public class ChatOptions
{
    public string ModelId { get; set; } = string.Empty;
    public string? SystemPrompt { get; set; }
    public double? Temperature { get; set; }
    public int? MaxTokens { get; set; }
    public bool Stream { get; set; }
    /// <summary>
    /// 推理强度（native 模式）：low / medium / high
    /// </summary>
    public string? ReasoningEffort { get; set; }
}

public class CompletionOptions
{
    public string ModelId { get; set; } = string.Empty;
    public string? SystemPrompt { get; set; }
    public double? Temperature { get; set; }
    public int? MaxTokens { get; set; }
}

public interface ILLMProvider
{
    string ProviderType { get; }
    bool SupportsStreaming { get; }
    Task<string> ChatAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default);
    IAsyncEnumerable<string> ChatStreamAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default);
    Task<string> CompleteAsync(string prompt, CompletionOptions options, CancellationToken cancellationToken = default);
}
