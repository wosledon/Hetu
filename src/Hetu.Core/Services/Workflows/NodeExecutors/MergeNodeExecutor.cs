using System.Text.Json;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Merge 节点：合并多条分支的输出。收集所有入边上游节点的输出，
/// 无 outputTemplate 时输出 JSON 对象 { sourceNodeId: output }，有则解析模板。
/// 配置 JSON: { "outputTemplate": "{{branchA.output}}" }
/// </summary>
public class MergeNodeExecutor : INodeExecutor
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public string NodeType => WorkflowNodeTypes.Merge;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct, IWorkflowEventSink? sink = null)
    {
        // 收集所有入边上游节点的输出
        var upstreamEdges = ctx.Edges.Where(e => e.Target == node.Id).ToList();
        var outputs = new Dictionary<string, string>();
        foreach (var edge in upstreamEdges)
        {
            var source = edge.Source;
            var output = ctx.GetVariableText($"{source}.output");
            if (!string.IsNullOrWhiteSpace(output))
                outputs[source] = output;
        }

        string? outputTemplate = null;
        if (!string.IsNullOrWhiteSpace(node.Config))
        {
            try
            {
                using var doc = JsonDocument.Parse(node.Config!);
                if (doc.RootElement.TryGetProperty("outputTemplate", out var ot) && ot.ValueKind == JsonValueKind.String)
                    outputTemplate = ot.GetString();
            }
            catch { }
        }

        string? mergedOutput;
        if (!string.IsNullOrWhiteSpace(outputTemplate))
            mergedOutput = TemplateResolver.Resolve(outputTemplate, ctx);
        else
            mergedOutput = JsonSerializer.Serialize(outputs);

        var result = new NodeResult { Output = mergedOutput };
        result.ExtraVariables["merged"] = JsonSerializer.Serialize(outputs);
        return Task.FromResult(result);
    }
}
