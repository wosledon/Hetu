namespace Hetu.Core.Entities;

public class Skill : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public bool IsBuiltIn { get; set; }
    public bool IsEnabled { get; set; } = true;
    public string? Config { get; set; }
    public int SortOrder { get; set; }
}
