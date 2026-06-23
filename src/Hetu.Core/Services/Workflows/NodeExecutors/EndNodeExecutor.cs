using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>End 节点：收集最终输出，终止工作流</summary>
public class EndNodeExecutor : INodeExecutor
{
    public string NodeType => WorkflowNodeTypes.End;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        // 解析输出模板，默认引用 start.input 或上一个节点的 output
        var config = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(node.Config ?? "{}");
        var outputTemplate = config?.TryGetValue("outputTemplate", out var ot) == true ? ot?.ToString() : null;

        var output = !string.IsNullOrWhiteSpace(outputTemplate)
            ? TemplateResolver.Resolve(outputTemplate!, ctx)
            : ctx.Input ?? "";

        return Task.FromResult(new NodeResult { Output = output, ShouldEnd = true });
    }
}
