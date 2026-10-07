namespace Hetu.Core.Entities;

/// <summary>项目分组：把本地 / SSH 远程项目目录归入分组，仅用于目录管理</summary>
public class ProjectGroup : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public List<ManagedProject> Projects { get; set; } = [];
}

/// <summary>
/// 受管项目目录：本地目录或 SSH 远程目录的登记条目。
/// 只负责目录的分组 / 归类与快速打开，不承载会话、消息等编码工作流。
/// </summary>
public class ManagedProject : BaseEntity
{
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
    /// <summary>DataProtection 加密的 SSH 密码（Password 认证）</summary>
    public string? SshPasswordProtected { get; set; }
    /// <summary>所属分组；为空表示未分组</summary>
    public Guid? GroupId { get; set; }
    public ProjectGroup? Group { get; set; }
    /// <summary>分类（单一归类），如 前端 / 服务端 / 工具 / 实验</summary>
    public string? Category { get; set; }
    /// <summary>标签（JSON 字符串数组），用于横向归类</summary>
    public string? Tags { get; set; }
    /// <summary>置顶：排在列表最前</summary>
    public bool IsPinned { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset? LastOpenedAt { get; set; }
}
