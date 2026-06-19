namespace Hetu.Core.Entities;

public class ShareLink : BaseEntity
{
    public Guid NoteId { get; set; }
    public Note Note { get; set; } = null!;
    public string ShareCode { get; set; } = string.Empty;
    public DateTimeOffset? ExpiresAt { get; set; }
    public int ViewCount { get; set; }
    public bool IsActive { get; set; } = true;
}
