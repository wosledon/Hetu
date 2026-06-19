namespace Hetu.Core.Entities;

public class Tag : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Color { get; set; }
    public List<NoteTag> NoteTags { get; set; } = [];
}
