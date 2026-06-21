namespace Hetu.Core.Entities;

/// <summary>
/// 话题笔记同步状态
/// </summary>
public enum NoteSyncStatus
{
    /// <summary>待整理 — 从未生成过笔记</summary>
    Pending = 0,
    /// <summary>已整理 — 已生成笔记，内容未变</summary>
    Synced = 1,
    /// <summary>已变更 — 曾生成过笔记，但之后对话有更新</summary>
    Outdated = 2,
}

public class ChatTopic : BaseEntity
{
    public Guid GroupId { get; set; }
    public ChatGroup Group { get; set; } = null!;
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? CustomSystemPrompt { get; set; }
    public NoteSyncStatus NoteSyncStatus { get; set; } = NoteSyncStatus.Pending;
    public bool IsAutoOrganizeEnabled { get; set; }
    public Guid? AutoOrganizeNotebookId { get; set; }
    public Guid? ParentTopicId { get; set; }
    public Guid? BranchMessageId { get; set; }
    public List<ChatMessage> Messages { get; set; } = [];
}
