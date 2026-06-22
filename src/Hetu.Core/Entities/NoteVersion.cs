namespace Hetu.Core.Entities;

public class NoteVersion : BaseEntity
{
    public Guid NoteId { get; set; }
    public Note? Note { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}
