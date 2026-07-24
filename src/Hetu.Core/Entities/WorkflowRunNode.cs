namespace Hetu.Core.Entities;

/// <summary>
/// 工作流节点级执行记录。每次节点执行产生一条，关联 WorkflowRun。
/// </summary>
public class WorkflowRunNode : BaseEntity
{
    public Guid RunId { get; set; }

    /// <summary>节点 ID（对应 Workflow.Nodes 中的 id）</summary>
    public string NodeId { get; set; } = string.Empty;

    /// <summary>节点类型</summary>
    public string NodeType { get; set; } = string.Empty;

    /// <summary>执行状态：Pending / Running / Succeeded / Failed / Skipped</summary>
    public string Status { get; set; } = "Pending";

    /// <summary>JSON: 节点输入</summary>
    public string? Input { get; set; }

    /// <summary>JSON: 节点输出</summary>
    public string? Output { get; set; }

    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? Error { get; set; }

    /// <summary>该节点在本次运行中被访问的次数（用于循环/分支统计）</summary>
    public int Iterations { get; set; }
}
