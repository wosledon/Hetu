namespace Hetu.Core.Entities;

public class ChatMessage : BaseEntity
{
    public Guid TopicId { get; set; }
    public ChatTopic Topic { get; set; } = null!;
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    public Guid? ParentId { get; set; }
    public Guid? ModelId { get; set; }
    public int? TokensUsed { get; set; }
    public int? CachedTokens { get; set; }
    public int? LatencyMs { get; set; }
    public string? ThinkingContent { get; set; }
    public string? SearchResultsJson { get; set; }
    public string? KnowledgeResultsJson { get; set; }
    public string? MemoryResultsJson { get; set; }
    /// <summary>原始输入 Token 数（压缩前估算）</summary>
    public int? InputTokens { get; set; }
    /// <summary>压缩后实际发送的 Prompt Token 数</summary>
    public int? CompressedTokens { get; set; }
    /// <summary>LLM 输出的 Completion Token 数</summary>
    public int? OutputTokens { get; set; }
}
