using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 按需加载工具的参数说明。会话只常驻常用工具的 schema（省上下文），
/// 其余工具的名字清单在系统提示里；需要用到时先调用本工具取回 schema，同一轮内即可直接调用。
/// </summary>
public class LoadToolsTool : IToolExecutor
{
    private readonly IServiceProvider _services;

    // 注意：不能直接注入 ToolRegistry —— 它由全部 IToolExecutor 构造，直接注入会形成循环依赖
    public LoadToolsTool(IServiceProvider services) => _services = services;

    public string Name => "load_tools";

    public string Description => "按需加载工具的完整参数说明（会话默认只常驻基础工具，其余工具需先加载再调用）";

    public string? UsageGuideline =>
        "系统提示里「按需加载」列出的工具，调用前先用本工具加载参数说明：names 传工具名或分组名（如「任务看板」），也可用 query 按关键词搜（如 query=\"看板\"）；已常驻的工具无需加载。";

    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;

    public ToolRisk Risk => ToolRisk.Read;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "names": {
                "type": "array",
                "items": { "type": "string" },
                "description": "要加载的工具名或分组名（可一次传多个，取系统提示里列出的名字/分组）"
            },
            "query": {
                "type": "string",
                "description": "按关键词搜索可加载的工具（匹配名称与说明），与 names 二选一"
            }
        }
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    private static readonly JsonSerializerOptions SchemaJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        var requested = new List<string>();
        var query = string.Empty;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            if (doc.RootElement.TryGetProperty("names", out var array) && array.ValueKind == JsonValueKind.Array)
            {
                requested.AddRange(array.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString() ?? string.Empty)
                    .Where(n => n.Length > 0));
            }
            else if (doc.RootElement.TryGetProperty("name", out var single) && single.ValueKind == JsonValueKind.String)
            {
                requested.Add(single.GetString() ?? string.Empty);
            }
            if (doc.RootElement.TryGetProperty("query", out var q) && q.ValueKind == JsonValueKind.String)
                query = (q.GetString() ?? string.Empty).Trim();
        }
        catch (JsonException ex)
        {
            return Task.FromResult(ToolExecutionResult.Error($"参数解析失败：{ex.Message}"));
        }

        var registry = _services.GetRequiredService<ToolRegistry>();

        // 分组名展开：names 里既可以是工具名，也可以是「任务看板」这类分组名
        var groupNames = new HashSet<string>(ToolGroupMap.Order, StringComparer.OrdinalIgnoreCase);
        var requestedGroups = requested.Where(r => groupNames.Contains(r)).ToList();
        var requestedTools = requested.Where(r => !groupNames.Contains(r)).ToList();

        List<IToolExecutor> executors;
        if (query.Length > 0)
        {
            executors = registry.GetAll().Where(e =>
                e.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                e.Description.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                (e.UsageGuideline?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false) ||
                ToolGroupMap.Resolve(e.Name).Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
        }
        else
        {
            var names = new List<string>(requestedTools);
            if (requestedGroups.Count > 0)
                names.AddRange(registry.GetAll().Where(e => requestedGroups.Contains(ToolGroupMap.Resolve(e.Name), StringComparer.OrdinalIgnoreCase)).Select(e => e.Name));
            executors = registry.GetByNames(names).ToList();
        }

        if (executors.Count == 0)
            return Task.FromResult(ToolExecutionResult.Error(query.Length > 0
                ? $"没有匹配「{query}」的可加载工具，可用分组：{string.Join("、", ToolGroupMap.Order)}"
                : "未找到指定工具或分组，请核对系统提示里列出的名字"));

        var sb = new StringBuilder();
        sb.AppendLine($"已加载 {executors.Count} 个工具的参数说明，现在可以直接调用：");
        foreach (var executor in executors)
        {
            sb.AppendLine();
            sb.AppendLine($"### {executor.Name}");
            sb.AppendLine(executor.UsageGuideline ?? executor.Description);
            sb.AppendLine(JsonSerializer.Serialize(new LlmToolDefinition
            {
                Name = executor.Name,
                Description = executor.Description,
                ParametersSchema = executor.ParametersSchema,
            }, SchemaJson));
        }
        return Task.FromResult(ToolExecutionResult.Success(sb.ToString().TrimEnd()));
    }
}
