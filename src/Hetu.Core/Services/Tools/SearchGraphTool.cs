using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public class SearchGraphTool : IToolExecutor
{
    private readonly IGraphService _graphService;

    public SearchGraphTool(IGraphService graphService)
    {
        _graphService = graphService;
    }

    public string Name => "search_graph";
    public string Description => "搜索知识图谱中的实体和关系";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public string? UsageGuideline => "用户询问概念之间的关系、相关笔记、知识脉络时调用；单点信息查询优先用 search_notes。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "query": { "type": "string", "description": "搜索关键词" },
            "type": { "type": "string", "description": "实体类型过滤（可选）" }
        },
        "required": ["query"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var query = root.GetProperty("query").GetString() ?? "";
            string? type = null;
            if (root.TryGetProperty("type", out var typeProp) && typeProp.ValueKind == JsonValueKind.String)
                type = typeProp.GetString();

            if (string.IsNullOrWhiteSpace(query))
                return ToolExecutionResult.Error("query 参数不能为空");

            var result = await _graphService.SearchEntitiesAsync(query, type, 10, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "搜索图谱失败");

            var output = JsonSerializer.Serialize(result.Data.Select(e => new
            {
                id = e.Id,
                name = e.Name,
                type = e.Type,
                description = e.Description
            }));

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"搜索图谱失败: {ex.Message}");
        }
    }
}
