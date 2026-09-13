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
    /// <summary>readonly | ask | auto | bypass</summary>
    public string PermissionMode { get; set; } = "ask";
    public int MessageCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateWorkSessionRequest
{
    public Guid ProjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? PermissionMode { get; set; }
}

public class UpdateWorkSessionRequest
{
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? PermissionMode { get; set; }
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
    /// <summary>本轮权限模式（readonly | ask | auto | bypass），传入时同时持久化到会话</summary>
    public string? PermissionMode { get; set; }
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

/// <summary>文件变更记录（用于 diff 展示）</summary>
public class WorkFileChangeDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid? SessionId { get; set; }
    public string FilePath { get; set; } = string.Empty;
    public string? OldContent { get; set; }
    public string NewContent { get; set; } = string.Empty;
    public string Action { get; set; } = "write";
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>项目级工具审批规则</summary>
public class WorkApprovalRuleDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public string ToolName { get; set; } = "*";
    public string? PathPattern { get; set; }
    public string Decision { get; set; } = "allow";
    public bool IsEnabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}

public class CreateWorkApprovalRuleRequest
{
    public string ToolName { get; set; } = "*";
    public string? PathPattern { get; set; }
    public string Decision { get; set; } = "allow";
}

/// <summary>检查点（工具批次前的文件快照）</summary>
public class WorkCheckpointDto
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public string Label { get; set; } = string.Empty;
    public string Tools { get; set; } = string.Empty;
    public int FileCount { get; set; }
    public List<string> Files { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>检查点恢复结果</summary>
public class RestoreCheckpointResultDto
{
    public Guid CheckpointId { get; set; }
    public int RestoredCount { get; set; }
    public int DeletedCount { get; set; }
    public List<string> Errors { get; set; } = [];
}

/// <summary>项目内文件搜索结果</summary>
public class WorkFileSearchHitDto
{
    public string Path { get; set; } = string.Empty;
    public int Line { get; set; }
    public string Text { get; set; } = string.Empty;
}
