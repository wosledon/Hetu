namespace Hetu.Shared.Notes;

public class NotebookDto
{
    public Guid Id { get; set; }
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public List<NotebookDto> Children { get; set; } = [];
}

public class CreateNotebookRequest
{
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = string.Empty;
}

public class UpdateNotebookRequest
{
    public string Name { get; set; } = string.Empty;
    public Guid? ParentId { get; set; }
    public int SortOrder { get; set; }
}
