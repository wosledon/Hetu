namespace Hetu.Core.Entities;

/// <summary>工作项目：以代码/项目为维度的协作单元，绑定本地目录</summary>
public class WorkProject : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    /// <summary>项目本地根目录</summary>
    public string RootPath { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    public int SortOrder { get; set; }
    public List<WorkSession> Sessions { get; set; } = [];
}

/// <summary>工作会话：项目下的单次工作上下文，承载消息与任务</summary>
public class WorkSession : BaseEntity
{
    public Guid ProjectId { get; set; }
    public WorkProject Project { get; set; } = null!;
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    /// <summary>权限模式：readonly | ask | auto | bypass</summary>
    public string PermissionMode { get; set; } = "ask";
    public List<WorkMessage> Messages { get; set; } = [];
}

/// <summary>
/// 工作会话消息：支持普通文本、工具调用、文件变更、子 Agent 等多种类型。
/// Type 取值：text | file_change | subagent | tool | system
/// </summary>
public class WorkMessage : BaseEntity
{
    public Guid SessionId { get; set; }
    public WorkSession Session { get; set; } = null!;
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    public string Type { get; set; } = "text";
    /// <summary>结构化附加数据（JSON，如 file_change 的路径/操作、subagent 的名称/状态）</summary>
    public string? Metadata { get; set; }
    public Guid? ModelId { get; set; }
}

/// <summary>
/// 项目级工具审批规则：命中后自动放行或拒绝，免去重复确认。
/// </summary>
public class WorkApprovalRule : BaseEntity
{
    public Guid ProjectId { get; set; }
    /// <summary>工具名，"*" 表示所有工具</summary>
    public string ToolName { get; set; } = "*";
    /// <summary>相对项目根的路径通配符（如 src/**），留空表示不限制路径</summary>
    public string? PathPattern { get; set; }
    /// <summary>allow | deny</summary>
    public string Decision { get; set; } = "allow";
    public bool IsEnabled { get; set; } = true;
}

/// <summary>
/// 工具批次开始前的文件快照，用于整体回滚本轮修改。
/// </summary>
public class WorkCheckpoint : BaseEntity
{
    public Guid ProjectId { get; set; }
    public Guid SessionId { get; set; }
    /// <summary>可读标签，如 "第 3 轮 · 修改 2 个文件"</summary>
    public string Label { get; set; } = string.Empty;
    /// <summary>触发的工具名（逗号分隔）</summary>
    public string Tools { get; set; } = string.Empty;
    public int FileCount { get; set; }
    public List<WorkCheckpointFile> Files { get; set; } = [];
}

/// <summary>检查点内的单个文件快照；Content 为 null 表示快照时文件尚不存在</summary>
public class WorkCheckpointFile : BaseEntity
{
    public Guid CheckpointId { get; set; }
    public WorkCheckpoint Checkpoint { get; set; } = null!;
    public string FilePath { get; set; } = string.Empty;
    public string? Content { get; set; }
}
