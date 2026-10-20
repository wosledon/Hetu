namespace Hetu.Shared.Notes;

public class NoteDto
{
    public Guid Id { get; set; }
    /// <summary>父笔记 Id；为空表示根级笔记</summary>
    public Guid? ParentId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    /// <summary>笔记图标（emoji）；为空使用默认笔记图标</summary>
    public string? Icon { get; set; }
    public bool IsDeleted { get; set; }
    public bool IsFavorite { get; set; }
    public bool IsPinned { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public List<TagDto> Tags { get; set; } = [];
}

public class CreateNoteRequest
{
    /// <summary>父笔记 Id；为空表示根级笔记</summary>
    public Guid? ParentId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    /// <summary>笔记图标（emoji）</summary>
    public string? Icon { get; set; }
}

public class UpdateNoteRequest
{
    public string? Title { get; set; }
    public string? Content { get; set; }
    /// <summary>移动到指定父笔记下（仅在传值时生效，用于创建时指定父级）</summary>
    public Guid? ParentId { get; set; }
    /// <summary>笔记图标（emoji）；传空串清除图标</summary>
    public string? Icon { get; set; }
    public bool? IsFavorite { get; set; }
    public bool? IsPinned { get; set; }
}

public class MoveNoteRequest
{
    /// <summary>目标父笔记 Id；为空表示移到根级</summary>
    public Guid? ParentId { get; set; }
}

public class NoteVersionDto
{
    public Guid Id { get; set; }
    public Guid NoteId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}
