using System.Text.Json;
using Hetu.Shared.Workflow;
using Microsoft.Extensions.DependencyInjection;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// SubWorkflow 节点：递归调用另一个工作流。通过 IServiceProvider 懒加载 WorkflowExecutionEngine 避免循环依赖。
/// 配置 JSON: { "subWorkflowId": "guid", "inputTemplate": "{{start.input}}" }
/// 递归深度上限 5，防止无限递归。
/// </summary>
public class SubWorkflowNodeExecutor : INodeExecutor
{
    private readonly IServiceProvider _serviceProvider;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public SubWorkflowNodeExecutor(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    public string NodeType => WorkflowNodeTypes.SubWorkflow;

    public async Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        var config = ParseConfig(node.Config);
        if (config == null || !config.TryGetValue("subWorkflowId", out var swid) || swid == null)
            return new NodeResult { Error = "SubWorkflow 节点未配置 subWorkflowId" };

        if (!Guid.TryParse(swid.ToString(), out var subWorkflowId))
            return new NodeResult { Error = $"subWorkflowId 格式无效：{swid}" };

        var inputTemplate = config.TryGetValue("inputTemplate", out var it) ? it?.ToString() : null;
        var subInput = TemplateResolver.Resolve(inputTemplate ?? "", ctx);

        // 懒加载引擎避免循环依赖
        using var scope = _serviceProvider.CreateScope();
        var engine = scope.ServiceProvider.GetRequiredService<WorkflowExecutionEngine>();

        var depth = GetDepth(ctx) + 1;
        if (depth > 5)
            return new NodeResult { Error = "SubWorkflow 递归深度超过上限 5" };

        var subResult = await engine.ExecuteAsync(subWorkflowId, subInput, ct, depth);
        if (subResult.Status != "Succeeded")
            return new NodeResult { Error = subResult.Error ?? "子工作流执行失败" };

        return new NodeResult { Output = subResult.Output ?? "" };
    }

    private static int GetDepth(ExecutionContext ctx)
    {
        if (ctx.TryGetVariable("__depth", out var el) && el.TryGetInt32(out var d))
            return d;
        return 0;
    }

    private static Dictionary<string, object>? ParseConfig(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return null;
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(configJson, JsonOptions); }
        catch { return null; }
    }
}
