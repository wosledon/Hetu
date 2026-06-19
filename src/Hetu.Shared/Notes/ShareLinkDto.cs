namespace Hetu.Shared.Notes;

public class ShareLinkDto
{
    public Guid Id { get; set; }
    public Guid NoteId { get; set; }
    public string ShareCode { get; set; } = string.Empty;
    public string ShareUrl { get; set; } = string.Empty;
    public DateTimeOffset? ExpiresAt { get; set; }
    public int ViewCount { get; set; }
    public bool IsActive { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class CreateShareLinkRequest
{
    public Guid NoteId { get; set; }
    public int? ExpiresInHours { get; set; }
}

public class SharedNoteDto
{
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
