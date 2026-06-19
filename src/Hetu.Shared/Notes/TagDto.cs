namespace Hetu.Shared.Notes;

public class TagDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Color { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public int NoteCount { get; set; }
}

public class CreateTagRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Color { get; set; }
}

public class UpdateTagRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Color { get; set; }
}

public class ManageNoteTagsRequest
{
    public List<Guid> TagIds { get; set; } = [];
}

public class MergeTagsRequest
{
    public List<Guid> SourceTagIds { get; set; } = [];
    public Guid TargetTagId { get; set; }
}
