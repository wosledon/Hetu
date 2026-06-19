namespace Hetu.Core.Entities;

public class ChatTopic : BaseEntity
{
    public Guid GroupId { get; set; }
    public ChatGroup Group { get; set; } = null!;
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? CustomSystemPrompt { get; set; }
    public int? ContextWindowSize { get; set; }
    public bool IsArchived { get; set; }
    public bool IsAutoOrganizeEnabled { get; set; }
    public Guid? AutoOrganizeNotebookId { get; set; }
    public Guid? ParentTopicId { get; set; }
    public Guid? BranchMessageId { get; set; }
    public List<ChatMessage> Messages { get; set; } = [];
}
