namespace Hetu.Core.Entities;

public class Note : BaseEntity
{
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;

    public Guid? NotebookId { get; set; }
    public Notebook? Notebook { get; set; }

    public List<NoteTag> NoteTags { get; set; } = [];

    /// <summary>该笔记对应的知识库项目</summary>
    public List<KnowledgeItem> KnowledgeItems { get; set; } = [];

    public bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public bool IsFavorite { get; set; }
    public bool IsPinned { get; set; }
}
