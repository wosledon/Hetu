namespace Hetu.Core.Entities;

public class NoteTag
{
    public Guid NoteId { get; set; }
    public Note? Note { get; set; }

    public Guid TagId { get; set; }
    public Tag? Tag { get; set; }
}
