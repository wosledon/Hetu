using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;

namespace Hetu.Core.Services;

/// <summary>
/// 将 MCP 工具适配为 <see cref="IToolExecutor"/>，使 Agent Loop 能像调用内置工具一样调用 MCP 工具。
/// 每个 MCP 工具的调用会启动一个临时的 StdioMcpClient 子进程（与现有 McpService 行为一致）。
/// </summary>
public class McpToolAdapter : IToolExecutor
{
    private readonly string _serverName;
    private readonly string _connectionConfig;
    private readonly McpToolDto _tool;

    public McpToolAdapter(string serverName, string connectionConfig, McpToolDto tool)
    {
        _serverName = serverName;
        _connectionConfig = connectionConfig;
        _tool = tool;
        Name = BuildName(serverName, tool.Name);
        Description = string.IsNullOrWhiteSpace(tool.Description) ? $"MCP 工具 ({serverName}/{tool.Name})" : tool.Description!;
        ParametersSchema = NormalizeSchema(tool.InputSchema);
    }

    public string Name { get; }
    public string Description { get; }
    public JsonElement ParametersSchema { get; }
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        Dictionary<string, object>? arguments;
        try
        {
            arguments = string.IsNullOrWhiteSpace(argumentsJson)
                ? new Dictionary<string, object>()
                : JsonSerializer.Deserialize<Dictionary<string, object>>(argumentsJson) ?? new Dictionary<string, object>();
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"MCP 工具 {Name} 参数解析失败：{ex.Message}");
        }

        try
        {
            using var client = new StdioMcpClient(_connectionConfig);
            var result = await client.CallToolAsync(_tool.Name, arguments, cancellationToken);
            if (result.IsError)
                return ToolExecutionResult.Error(result.Content);
            return ToolExecutionResult.Success(result.Content);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"MCP 工具 {Name} 调用失败：{ex.Message}");
        }
    }

    /// <summary>构造统一的 MCP 工具名：mcp_{server}_{tool}，去除非法字符</summary>
    public static string BuildName(string serverName, string toolName)
    {
        var s = Sanitize(serverName);
        var t = Sanitize(toolName);
        return $"mcp_{s}_{t}";
    }

    private static string Sanitize(string input)
        => string.Concat(input.Where(c => char.IsLetterOrDigit(c) || c == '_' || c == '-'));

    private static JsonElement NormalizeSchema(object? schema)
    {
        if (schema is JsonElement je && je.ValueKind == JsonValueKind.Object)
            return je;
        // 回退为最宽松的 schema
        var fallback = JsonSerializer.SerializeToElement(new { type = "object", properties = new { } });
        return fallback;
    }
}
