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
    public int? LatencyMs { get; set; }
    public string? ThinkingContent { get; set; }
    public string? SearchResultsJson { get; set; }
}
