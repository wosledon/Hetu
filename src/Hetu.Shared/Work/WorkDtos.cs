namespace Hetu.Shared.Work;

public class WorkProjectDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string RootPath { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    public int SortOrder { get; set; }
    public int SessionCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateWorkProjectRequest
{
    public string Name { get; set; } = string.Empty;
    public string RootPath { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
}

public class UpdateWorkProjectRequest
{
    public string Name { get; set; } = string.Empty;
    public string RootPath { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    public int SortOrder { get; set; }
}

public class WorkSessionDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public int MessageCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateWorkSessionRequest
{
    public Guid ProjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
}

public class UpdateWorkSessionRequest
{
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
}

public class WorkMessageDto
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    public string Type { get; set; } = "text";
    public string? Metadata { get; set; }
    public Guid? ModelId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class SendWorkMessageRequest
{
    public string Content { get; set; } = string.Empty;
    public string? ModelId { get; set; }
    public bool EnableTools { get; set; } = true;
    public string? ToolApprovalMode { get; set; }
}

/// <summary>文件系统条目</summary>
public class WorkFileEntryDto
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }
    public long? Size { get; set; }
    public DateTimeOffset? ModifiedAt { get; set; }
}

/// <summary>文件内容</summary>
public class WorkFileContentDto
{
    public string Path { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public long Size { get; set; }
    public bool IsBinary { get; set; }
    public string? Content { get; set; }
    public DateTimeOffset? ModifiedAt { get; set; }
}
