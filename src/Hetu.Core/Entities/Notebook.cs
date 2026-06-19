namespace Hetu.Core.Entities;

public class Notebook : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public Guid? ParentId { get; set; }
    public Notebook? Parent { get; set; }
    public List<Notebook> Children { get; set; } = [];
    public List<Note> Notes { get; set; } = [];
    public int SortOrder { get; set; }
}
