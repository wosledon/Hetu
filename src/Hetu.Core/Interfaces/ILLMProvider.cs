

namespace Hetu.Core.Interfaces;

public class LlmChatMessage
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
}

public class ChatOptions
{
    public string ModelId { get; set; } = string.Empty;
    public string? SystemPrompt { get; set; }
    public double? Temperature { get; set; }
    public int? MaxTokens { get; set; }
    public bool Stream { get; set; }
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
    bool SupportsStreaming { get; }
    Task<string> ChatAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default);
    IAsyncEnumerable<string> ChatStreamAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default);
    Task<string> CompleteAsync(string prompt, CompletionOptions options, CancellationToken cancellationToken = default);
}
