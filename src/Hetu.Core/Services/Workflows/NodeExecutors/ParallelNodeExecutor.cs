using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Parallel 节点：标记节点，无实际执行逻辑。分路由引擎统一处理——
/// 任何节点有多条出边时自动分路执行所有分支链路，无需显式并行块。
/// </summary>
public class ParallelNodeExecutor : INodeExecutor
{
    public string NodeType => WorkflowNodeTypes.Parallel;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct, IWorkflowEventSink? sink = null)
    {
        return Task.FromResult(new NodeResult { Output = "" });
    }
}
