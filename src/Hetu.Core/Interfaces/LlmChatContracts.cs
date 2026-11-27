

namespace Hetu.Core.Interfaces;

public class LlmContentPart
{
    public string Type { get; set; } = "text";
    public string? Text { get; set; }
    public string? ImageUrl { get; set; }
    public string? MediaType { get; set; }
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
/// 单次 LLM 调用的 token 用量
/// </summary>
public class LlmUsage
{
    /// <summary>
    /// 本次请求的完整 Prompt Token。Anthropic 的 input_tokens 只含未命中缓存的部分，
    /// 适配器必须把 cache_read / cache_creation 一并计入，否则缓存命中率的分母会偏小。
    /// </summary>
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public int TotalTokens { get; set; }
    /// <summary>命中缓存读取的 Prompt Token（计费低于常规输入）</summary>
    public int CachedTokens { get; set; }
    /// <summary>本次写入缓存的 Prompt Token（Anthropic cache_creation_input_tokens，计费高于常规输入）</summary>
    public int CacheCreationTokens { get; set; }
}

/// <summary>非流式调用的结果：正文 + 用量（Provider 未上报用量时 Usage 为 null）</summary>
public class LlmChatResult
{
    public string Content { get; set; } = string.Empty;
    public LlmUsage? Usage { get; set; }
    /// <summary>模型单独返回的思考内容（若 Provider 有）。</summary>
    public string? Thinking { get; set; }
    /// <summary>结束原因（stop / length / max_tokens 等）。</summary>
    public string? FinishReason { get; set; }
    /// <summary>本次请求耗时（毫秒）。</summary>
    public long ElapsedMs { get; set; }
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

/// <summary>
/// 一段完整的思考块。Anthropic 扩展思考在工具调用后继续对话时，
/// 必须把带 signature 的思考块原样回传，否则模型每轮都要从零重想。
/// </summary>
public class LlmThinkingBlock
{
    public string Text { get; set; } = string.Empty;
    public string? Signature { get; set; }
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
    /// assistant 消息的思考块（仅 Anthropic 回传；OpenAI 兼容端不回传 reasoning_content）
    /// </summary>
    public List<LlmThinkingBlock>? ThinkingBlocks { get; set; }
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
    /// <summary>
    /// 推理强度（native 模式）：off/none/minimal/low/medium/high/xhigh/max 或供应商自定义字符串
    /// </summary>
    public string? ReasoningEffort { get; set; }
    /// <summary>
    /// 推理 Token 预算（Claude budget_tokens 风格；设置时优先于强度等级）
    /// </summary>
    public int? ReasoningBudgetTokens { get; set; }
}

public class CompletionOptions
{
    public string ModelId { get; set; } = string.Empty;
    public string? SystemPrompt { get; set; }
    public double? Temperature { get; set; }
    public int? MaxTokens { get; set; }
}
