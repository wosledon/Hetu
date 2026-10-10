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

    public string Description => "按需加载工具的完整参数说明（会话默认只常驻常用工具，其余工具需先加载再调用）";

    public string? UsageGuideline =>
        "系统提示里「可按需加载」列出的工具，调用前先用本工具加载其参数说明（names 传工具名，可传多个），随后即可直接调用；已常驻的工具无需加载。";

    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;

    public ToolRisk Risk => ToolRisk.Read;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "names": {
                "type": "array",
                "items": { "type": "string" },
                "description": "要加载的工具名（可一次传多个，取系统提示里列出的名字）"
            }
        },
        "required": ["names"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    private static readonly JsonSerializerOptions SchemaJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        var names = new List<string>();
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            if (doc.RootElement.TryGetProperty("names", out var array) && array.ValueKind == JsonValueKind.Array)
            {
                names.AddRange(array.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString() ?? string.Empty)
                    .Where(n => n.Length > 0));
            }
            else if (doc.RootElement.TryGetProperty("name", out var single) && single.ValueKind == JsonValueKind.String)
            {
                names.Add(single.GetString() ?? string.Empty);
            }
        }
        catch (JsonException ex)
        {
            return Task.FromResult(ToolExecutionResult.Error($"参数解析失败：{ex.Message}"));
        }

        var executors = _services.GetRequiredService<ToolRegistry>().GetByNames(names);
        if (executors.Count == 0)
            return Task.FromResult(ToolExecutionResult.Error("未找到指定工具，请核对系统提示里列出的工具名"));

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
