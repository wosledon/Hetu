namespace Hetu.Core.Entities;

public class Note : BaseEntity
{
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;

    /// <summary>父笔记（嵌套笔记）；为空表示根级笔记</summary>
    public Guid? ParentId { get; set; }
    public Note? Parent { get; set; }
    public List<Note> Children { get; set; } = [];

    /// <summary>笔记图标（emoji）；为空时前端使用默认笔记图标</summary>
    public string? Icon { get; set; }

    public List<NoteTag> NoteTags { get; set; } = [];

    /// <summary>该笔记对应的知识库项目</summary>
    public List<KnowledgeItem> KnowledgeItems { get; set; } = [];

    public bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public bool IsFavorite { get; set; }
    public bool IsPinned { get; set; }
}
