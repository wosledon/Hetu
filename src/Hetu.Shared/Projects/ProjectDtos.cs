namespace Hetu.Shared.Projects;

public class ManagedProjectDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    /// <summary>项目类型：Local | Ssh</summary>
    public string ProjectType { get; set; } = "Local";
    /// <summary>项目目录（本地路径，或远程主机上的绝对路径）</summary>
    public string DirectoryPath { get; set; } = string.Empty;
    public string? SshHost { get; set; }
    public int SshPort { get; set; } = 22;
    public string? SshUser { get; set; }
    /// <summary>SSH 认证方式：Key | Password | Agent</summary>
    public string SshAuthType { get; set; } = "Key";
    public string? SshKeyPath { get; set; }
    /// <summary>是否已保存 SSH 密码（不回传明文）</summary>
    public bool HasSshPassword { get; set; }
    /// <summary>所属分组 ID；为空表示未分组</summary>
    public Guid? GroupId { get; set; }
    public string? GroupName { get; set; }
    /// <summary>分类（单一归类）</summary>
    public string? Category { get; set; }
    /// <summary>标签（横向归类）</summary>
    public List<string> Tags { get; set; } = [];
    public bool IsPinned { get; set; }
    public int SortOrder { get; set; }
    /// <summary>关联的 Code 工作区项目 ID；为空表示尚未与 Code 互通</summary>
    public Guid? WorkProjectId { get; set; }
    public DateTimeOffset? LastOpenedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateManagedProjectRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    /// <summary>Local | Ssh</summary>
    public string ProjectType { get; set; } = "Local";
    public string DirectoryPath { get; set; } = string.Empty;
    public string? SshHost { get; set; }
    public int SshPort { get; set; } = 22;
    public string? SshUser { get; set; }
    /// <summary>Key | Password | Agent</summary>
    public string SshAuthType { get; set; } = "Key";
    public string? SshKeyPath { get; set; }
    /// <summary>SSH 密码明文（保存时加密，仅创建/更新时接收）</summary>
    public string? SshPassword { get; set; }
    public Guid? GroupId { get; set; }
    public string? Category { get; set; }
    public List<string>? Tags { get; set; }
}

public class UpdateManagedProjectRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    /// <summary>Local | Ssh；传入时切换项目类型</summary>
    public string? ProjectType { get; set; }
    public string DirectoryPath { get; set; } = string.Empty;
    public string? SshHost { get; set; }
    public int? SshPort { get; set; }
    public string? SshUser { get; set; }
    /// <summary>Key | Password | Agent</summary>
    public string? SshAuthType { get; set; }
    public string? SshKeyPath { get; set; }
    /// <summary>SSH 密码明文（null 保持不变，空串表示清除已存密码）</summary>
    public string? SshPassword { get; set; }
    /// <summary>目标分组 ID；显式传 null 表示移出分组（未分组）</summary>
    public Guid? GroupId { get; set; }
    public string? Category { get; set; }
    public List<string>? Tags { get; set; }
    public bool? IsPinned { get; set; }
    public int SortOrder { get; set; }
}

public class ProjectSortItem
{
    public Guid Id { get; set; }
    public int SortOrder { get; set; }
}

/// <summary>批量调整排序（拖拽排序后一次性持久化）</summary>
public class SortProjectsRequest
{
    public List<ProjectSortItem> Items { get; set; } = [];
}

public class ProjectGroupDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    /// <summary>组内项目数量</summary>
    public int ProjectCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>项目 Wiki 文档（AI 依据项目目录资料生成）</summary>
public class WikiDocumentDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>所属项目名称（列表展示用）</summary>
    public string ProjectName { get; set; } = string.Empty;
    /// <summary>所属 Wiki 套件 ID（一次生成的所有页面共享）</summary>
    public Guid SetId { get; set; }
    /// <summary>套件内排序：0 为总览页</summary>
    public int SortOrder { get; set; }
    public string Title { get; set; } = string.Empty;
    /// <summary>规划阶段确定的内容要点</summary>
    public string? Brief { get; set; }
    /// <summary>Markdown 正文</summary>
    public string Content { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Wiki 套件（一次生成的总览 + 主题页），含过期状态</summary>
public class WikiSetDto
{
    public Guid SetId { get; set; }
    public Guid ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int PageCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>生成后项目文件又发生过变更，内容可能已过期</summary>
    public bool IsStale { get; set; }
    /// <summary>生成后被修改或新增的文件数</summary>
    public int StaleFileCount { get; set; }
    /// <summary>页面清单（标题 + 排序）</summary>
    public List<WikiSetPageDto> Pages { get; set; } = [];
}

public class WikiSetPageDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}

/// <summary>Wiki 生成任务进度</summary>
public class WikiGenerationJobDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    /// <summary>0=Queued, 1=Running, 2=Completed, 3=Failed</summary>
    public int Status { get; set; }
    public string Stage { get; set; } = string.Empty;
    /// <summary>进度百分比 0-100</summary>
    public int Progress { get; set; }
    public int TotalPages { get; set; }
    public int DonePages { get; set; }
    public string? ErrorMessage { get; set; }
    public string? ModelId { get; set; }
    public Guid? SetId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

/// <summary>发起 Wiki 生成请求</summary>
public class GenerateWikiRequest
{
    /// <summary>指定生成所用模型；为空时用默认补全 / 对话模型</summary>
    public Guid? ModelId { get; set; }
}

public class CreateProjectGroupRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}

public class UpdateProjectGroupRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }
}
