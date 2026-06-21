

using System.Text.Json;

namespace Hetu.Core.Interfaces;

public class LlmContentPart
{
    public string Type { get; set; } = "text";
    public string? Text { get; set; }
    public string? ImageUrl { get; set; }
    public string? MediaType { get; set; }
}

/// <summary>
/// 工具定义，传给 LLM 让它知道可以调用哪些工具
/// </summary>
public class LlmToolDefinition
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public JsonElement ParametersSchema { get; set; }
}

/// <summary>
/// LLM 返回的工具调用请求
/// </summary>
public class LlmToolCall
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Arguments { get; set; } = "{}";
}

/// <summary>
/// 工具审批模式
/// </summary>
public enum ToolApprovalMode
{
    /// <summary>静默执行，结果折叠展示</summary>
    Bypass,
    /// <summary>自动执行，结果正常展示</summary>
    Auto,
    /// <summary>执行前暂停，等待用户确认</summary>
    Ask
}

public class LlmChatMessage
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    /// <summary>
    /// 多模态内容（文本 + 图片）。当有图片时，LLM Provider 会使用此字段而非 Content。
    /// </summary>
    public List<LlmContentPart>? ContentParts { get; set; }
    /// <summary>
    /// assistant 消息携带的工具调用请求（LLM 要求调用工具）
    /// </summary>
    public List<LlmToolCall>? ToolCalls { get; set; }
    /// <summary>
    /// tool 角色消息关联的工具调用 ID
    /// </summary>
    public string? ToolCallId { get; set; }
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
    /// <summary>
    /// 可用工具定义列表（传给 LLM）
    /// </summary>
    public List<LlmToolDefinition>? Tools { get; set; }
    /// <summary>
    /// 工具选择策略：auto / none / required / 指定工具名
    /// </summary>
    public string? ToolChoice { get; set; }
}

public class CompletionOptions
{
    public string ModelId { get; set; } = string.Empty;
    public string? SystemPrompt { get; set; }
    public double? Temperature { get; set; }
    public int? MaxTokens { get; set; }
}

/// <summary>
/// LLM 流式响应的结构化结果，包含文本内容和工具调用
/// </summary>
public class LlmStreamResult
{
    public string? Content { get; set; }
    public string? Thinking { get; set; }
    public List<LlmToolCall>? ToolCalls { get; set; }
    public bool HasToolCalls => ToolCalls is { Count: > 0 };
}

public interface ILLMProvider
{
    string ProviderType { get; }
    bool SupportsStreaming { get; }
    Task<string> ChatAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default);
    IAsyncEnumerable<string> ChatStreamAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default);
    Task<string> CompleteAsync(string prompt, CompletionOptions options, CancellationToken cancellationToken = default);
}
