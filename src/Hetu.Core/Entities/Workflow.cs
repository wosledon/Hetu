namespace Hetu.Core.Entities;

/// <summary>
/// 工作流定义。由节点（Nodes JSON）和边（Edges JSON）组成有向图，支持环路。
/// 节点类型：Start / Agent / Condition / End / Loop / Parallel / Tool / Human / SubWorkflow。
/// </summary>
public class Workflow : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    /// <summary>JSON: NodeDto[] — 节点定义（含 id/type/agentId/config/position 等）</summary>
    public string Nodes { get; set; } = "[]";

    /// <summary>JSON: EdgeDto[] — 边定义（含 source/target/sourceHandle/targetHandle）</summary>
    public string Edges { get; set; } = "[]";

    /// <summary>JSON: 输入参数 schema（Start 节点的输入定义）</summary>
    public string? InputSchema { get; set; }

    /// <summary>JSON: 工作流级变量默认值</summary>
    public string? Variables { get; set; }

    public int Version { get; set; } = 1;
    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; }
}
