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
    private readonly ILocalizer _localizer;

    public McpToolAdapter(string serverName, string connectionConfig, McpToolDto tool, ILocalizer localizer)
    {
        _serverName = serverName;
        _connectionConfig = connectionConfig;
        _tool = tool;
        _localizer = localizer;
        Name = BuildName(serverName, tool.Name);
        Description = string.IsNullOrWhiteSpace(tool.Description) ? $"MCP 工具 ({serverName}/{tool.Name})" : tool.Description!;
        ParametersSchema = NormalizeSchema(tool.InputSchema);
    }

    public string Name { get; }
    public string Description { get; }
    public JsonElement ParametersSchema { get; }
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;

    /// <summary>MCP 调用可能卡在远端，给一个兜底上限（Agent 循环的默认超时更短时以更短者为准）</summary>
    public TimeSpan? Timeout => TimeSpan.FromMinutes(5);

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
            return ToolExecutionResult.Error(_localizer.T("mcp.argsParseFailed", Name, ex.Message));
        }

        try
        {
            // 复用同一份配置的 MCP 子进程：避免每次工具调用都重新启动 + initialize
            var client = await McpClientPool.Shared.GetAsync(_connectionConfig, _localizer, cancellationToken);
            var result = await client.CallToolAsync(_tool.Name, arguments, cancellationToken);
            if (result.IsError)
                return ToolExecutionResult.Error(result.Content);
            return ToolExecutionResult.Success(result.Content);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // 进程可能已退出：摘除后下次重新启动，避免一直复用坏连接
            McpClientPool.Shared.Invalidate(_connectionConfig);
            return ToolExecutionResult.Error(_localizer.T("mcp.toolCallFailed", Name, ex.Message));
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
