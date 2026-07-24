using System.Text.Json;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Condition 节点：按配置的分支条件顺序求值，首个匹配的分支 handle 作为 BranchHandle 返回。
/// 无匹配时返回 "default" handle。
/// 配置 JSON: { "branches": [{ "handle": "true", "expression": "{{prev.output}} == 'yes'" }, ...] }
/// </summary>
public class ConditionNodeExecutor : INodeExecutor
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public string NodeType => WorkflowNodeTypes.Condition;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        string defaultHandle = "default";
        List<JsonElement>? branches = null;

        if (!string.IsNullOrWhiteSpace(node.Config))
        {
            try
            {
                using var doc = JsonDocument.Parse(node.Config!);
                if (doc.RootElement.TryGetProperty("branches", out var brArr) && brArr.ValueKind == JsonValueKind.Array)
                    branches = brArr.EnumerateArray().ToList();
                if (doc.RootElement.TryGetProperty("defaultHandle", out var dh) && dh.ValueKind == JsonValueKind.String)
                    defaultHandle = dh.GetString() ?? defaultHandle;
            }
            catch { }
        }

        if (branches != null)
        {
            foreach (var br in branches)
            {
                var handle = br.TryGetProperty("handle", out var h) ? h.GetString() : null;
                var expression = br.TryGetProperty("expression", out var e) ? e.GetString() : null;
                if (handle == null) continue;

                if (TemplateResolver.EvaluateCondition(expression, ctx))
                    return Task.FromResult(new NodeResult { BranchHandle = handle });
            }
        }

        return Task.FromResult(new NodeResult { BranchHandle = defaultHandle });
    }
}
