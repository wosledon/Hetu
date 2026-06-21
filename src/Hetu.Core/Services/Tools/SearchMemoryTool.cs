using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public class SearchMemoryTool : IToolExecutor
{
    private readonly IMemoryService _memoryService;

    public SearchMemoryTool(IMemoryService memoryService)
    {
        _memoryService = memoryService;
    }

    public string Name => "search_memory";
    public string Description => "搜索记忆（用户偏好、历史信息）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "query": { "type": "string", "description": "搜索关键词" },
            "topK": { "type": "integer", "description": "返回结果数量", "default": 5 }
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
            var topK = root.TryGetProperty("topK", out var topKProp) ? topKProp.GetInt32() : 5;

            if (string.IsNullOrWhiteSpace(query))
                return ToolExecutionResult.Error("query 参数不能为空");

            var result = await _memoryService.SearchAsync(query, topK, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "搜索记忆失败");

            var output = JsonSerializer.Serialize(result.Data.Select(m => new
            {
                id = m.Id,
                content = m.Content,
                category = m.Category,
                importance = m.Importance,
                score = m.Score,
                createdAt = m.CreatedAt
            }));

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"搜索记忆失败: {ex.Message}");
        }
    }
}
