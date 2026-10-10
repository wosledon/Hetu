using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Loop 节点：维护循环计数，检查退出条件。两条出边：handle="body"（进入循环体）和 handle="exit"（退出循环）。
/// 循环体最后一条边指回 Loop 节点，引擎再次执行 Loop 时计数 +1。
/// 配置 JSON: { "maxIterations": 5, "exitCondition": "{{prev.output}} == 'done'" }
/// </summary>
public class LoopNodeExecutor : INodeExecutor
{
    private readonly ILocalizer _localizer;

    public LoopNodeExecutor(ILocalizer localizer)
    {
        _localizer = localizer;
    }

    public string NodeType => WorkflowNodeTypes.Loop;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct, IWorkflowEventSink? sink = null)
    {
        var visitCount = ctx.GetVisitCount(node.Id); // 引擎在执行前已 +1，此处为当前轮次

        int maxIterations = 5;
        string? exitCondition = null;

        if (!string.IsNullOrWhiteSpace(node.Config))
        {
            try
            {
                using var doc = JsonDocument.Parse(node.Config!);
                if (doc.RootElement.TryGetProperty("maxIterations", out var mi) && mi.TryGetInt32(out var max))
                    maxIterations = max;
                if (doc.RootElement.TryGetProperty("exitCondition", out var ec))
                    exitCondition = ec.GetString();
            }
            catch { }
        }

        // 首次进入（visitCount==1）直接进入 body
        // 后续进入：检查退出条件或达到最大次数
        if (visitCount == 1)
            return Task.FromResult(new NodeResult { BranchHandle = "body", Output = _localizer.T("workflowNode.loopStarted") });

        // 检查退出条件
        if (!string.IsNullOrWhiteSpace(exitCondition) && TemplateResolver.EvaluateCondition(exitCondition, ctx))
            return Task.FromResult(new NodeResult { BranchHandle = "exit", Output = _localizer.T("workflowNode.loopExitedCondition", visitCount) });

        // 检查最大次数
        if (visitCount > maxIterations)
            return Task.FromResult(new NodeResult { BranchHandle = "exit", Output = _localizer.T("workflowNode.loopExitedMax", maxIterations) });

        // 继续循环
        return Task.FromResult(new NodeResult { BranchHandle = "body", Output = _localizer.T("workflowNode.loopRound", visitCount) });
    }
}
