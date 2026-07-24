using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Tool 节点：直接调用内置工具或 MCP 工具（不经 LLM）。
/// 配置 JSON: { "toolName": "search_notes", "argumentsTemplate": "{ \"query\": \"{{start.input}}\" }" }
/// </summary>
public class ToolNodeExecutor : INodeExecutor
{
    private readonly ToolRegistry _toolRegistry;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public ToolNodeExecutor(ToolRegistry toolRegistry)
    {
        _toolRegistry = toolRegistry;
    }

    public string NodeType => WorkflowNodeTypes.Tool;

    public async Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        var config = ParseConfig(node.Config);
        if (config == null || !config.TryGetValue("toolName", out var tn) || tn == null)
            return new NodeResult { Error = "Tool 节点未配置 toolName" };

        var toolName = tn.ToString()!;
        var executor = _toolRegistry.GetExecutor(toolName);
        if (executor == null)
            return new NodeResult { Error = $"工具 {toolName} 不存在" };

        var argsTemplate = config.TryGetValue("argumentsTemplate", out var at) ? at?.ToString() : "{}";
        var argumentsJson = TemplateResolver.Resolve(argsTemplate, ctx);

        try
        {
            var result = await executor.ExecuteAsync(argumentsJson, ct);
            return new NodeResult
            {
                Output = result.Content,
                Error = result.IsError ? result.Content : null
            };
        }
        catch (Exception ex)
        {
            return new NodeResult { Error = $"工具 {toolName} 执行失败：{ex.Message}" };
        }
    }

    private static Dictionary<string, object>? ParseConfig(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return null;
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(configJson, JsonOptions); }
        catch { return null; }
    }
}
