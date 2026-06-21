namespace Hetu.Core.Entities;

public class TaskItem : BaseEntity
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    /// <summary>0=Todo, 1=InProgress, 2=Done, 3=Blocked</summary>
    public int Status { get; set; }
    /// <summary>0=Low, 1=Medium, 2=High, 3=Urgent</summary>
    public int Priority { get; set; }
    public int Progress { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? Tags { get; set; }
    public int SortOrder { get; set; }
    public bool IsDeleted { get; set; }
}
