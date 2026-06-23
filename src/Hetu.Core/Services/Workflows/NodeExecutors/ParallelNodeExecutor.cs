using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Parallel 节点：标记节点，实际 fan-out 由引擎处理。
/// 引擎识别 Parallel 类型后并发执行所有出边目标节点，收集结果到 {nodeId}.branches。
/// </summary>
public class ParallelNodeExecutor : INodeExecutor
{
    public string NodeType => WorkflowNodeTypes.Parallel;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        return Task.FromResult(new NodeResult { Output = "并行分支开始", BranchHandle = "__parallel_fanout__" });
    }
}
