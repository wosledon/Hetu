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
