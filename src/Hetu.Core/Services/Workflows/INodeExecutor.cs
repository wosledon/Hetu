using Hetu.Core.Interfaces;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows;

/// <summary>
/// 节点执行器接口。每种节点类型（Start/Agent/Condition/...）实现此接口，
/// 通过 DI 多注册（参考 IScheduledTaskExecutor 模式），引擎按 NodeType 分发。
/// </summary>
public interface INodeExecutor
{
    /// <summary>节点类型（对应 WorkflowNodeTypes 常量）</summary>
    string NodeType { get; }

    /// <summary>
    /// 执行节点。
    /// </summary>
    /// <param name="node">节点定义</param>
    /// <param name="ctx">执行上下文（可读写变量）</param>
    /// <param name="ct">取消令牌</param>
    /// <returns>执行结果，含输出值与（条件/循环节点的）分支选择</returns>
    Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct);
}

/// <summary>节点执行结果</summary>
public class NodeResult
{
    /// <summary>节点输出（存入上下文 {nodeId}.output）</summary>
    public string? Output { get; set; }

    /// <summary>额外变量（存入上下文 {nodeId}.{key}）</summary>
    public Dictionary<string, string> ExtraVariables { get; set; } = new();

    /// <summary>条件/循环节点选择的分支 handle（引擎据此选择下一条边）</summary>
    public string? BranchHandle { get; set; }

    /// <summary>是否应终止工作流（End 节点返回 true）</summary>
    public bool ShouldEnd { get; set; }

    /// <summary>错误信息（非空时引擎将标记节点失败）</summary>
    public string? Error { get; set; }
}
