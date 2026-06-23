using System.Text.Json;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>Start 节点：接收工作流输入，注入到上下文</summary>
public class StartNodeExecutor : INodeExecutor
{
    public string NodeType => WorkflowNodeTypes.Start;

    public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        // 将原始输入存为 start.input
        ctx.SetVariable(node.Id, "input", ctx.Input ?? "");

        // 尝试解析为 JSON 对象，把每个字段也作为独立变量
        if (!string.IsNullOrWhiteSpace(ctx.Input))
        {
            try
            {
                using var doc = JsonDocument.Parse(ctx.Input!);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in doc.RootElement.EnumerateObject())
                        ctx.SetVariable(node.Id, prop.Name, prop.Value.Clone());
                }
            }
            catch { /* 非 JSON 输入，忽略 */ }
        }

        return Task.FromResult(new NodeResult { Output = ctx.Input ?? "" });
    }
}
