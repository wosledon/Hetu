namespace Hetu.Shared.Notes;

public class NoteDto
{
    public Guid Id { get; set; }
    public Guid? NotebookId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
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
    public Guid? NotebookId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}

public class UpdateNoteRequest
{
    public string? Title { get; set; }
    public string? Content { get; set; }
    public Guid? NotebookId { get; set; }
    public bool? IsFavorite { get; set; }
    public bool? IsPinned { get; set; }
}

public class MoveNoteRequest
{
    public Guid? NotebookId { get; set; }
}

public class NoteVersionDto
{
    public Guid Id { get; set; }
    public Guid NoteId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}
