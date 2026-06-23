namespace Hetu.Core.Entities;

/// <summary>
/// 工作流运行实例。记录单次执行的状态、输入输出，以及关联的对话话题（对话内调用时）。
/// </summary>
public class WorkflowRun : BaseEntity
{
    public Guid WorkflowId { get; set; }

    /// <summary>运行状态：Pending / Running / Succeeded / Failed / Cancelled</summary>
    public string Status { get; set; } = "Pending";

    /// <summary>JSON: 运行输入参数</summary>
    public string? Input { get; set; }

    /// <summary>JSON: 运行最终输出</summary>
    public string? Output { get; set; }

    /// <summary>JSON: 运行时的节点/边快照（保证历史可回放，与当前 Workflow 定义解耦）</summary>
    public string? GraphSnapshot { get; set; }

    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>对话内调用时关联的话题 ID</summary>
    public Guid? ChatTopicId { get; set; }

    public string? Error { get; set; }

    /// <summary>总迭代次数（节点访问累计）</summary>
    public int TotalIterations { get; set; }
}
