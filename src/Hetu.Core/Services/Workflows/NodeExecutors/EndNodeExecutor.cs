using System.Linq;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>End 节点：收集最终输出，终止工作流</summary>
public class EndNodeExecutor : INodeExecutor
{
    public string NodeType => WorkflowNodeTypes.End;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        var config = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(node.Config ?? "{}");
        var outputTemplate = config?.TryGetValue("outputTemplate", out var ot) == true ? ot?.ToString() : null;

        string? output = null;
        if (!string.IsNullOrWhiteSpace(outputTemplate))
        {
            output = TemplateResolver.Resolve(outputTemplate!, ctx);
        }
        else
        {
            // 无模板时，收集所有入边的上游节点输出，用第一个非空的
            var upstreamEdges = ctx.Edges.Where(e => e.Target == node.Id).ToList();
            foreach (var edge in upstreamEdges)
            {
                var upstreamOutput = ctx.GetVariableText($"{edge.Source}.output");
                if (!string.IsNullOrWhiteSpace(upstreamOutput))
                {
                    output = upstreamOutput;
                    break;
                }
            }
            // 没有任何上游输出时，回退到原始输入
            if (string.IsNullOrWhiteSpace(output))
                output = ctx.Input ?? "";
        }

        return Task.FromResult(new NodeResult { Output = output, ShouldEnd = true });
    }
}
