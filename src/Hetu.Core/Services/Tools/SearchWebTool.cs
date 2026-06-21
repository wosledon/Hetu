using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public class SearchWebTool : IToolExecutor
{
    private readonly IWebSearchService _webSearchService;

    public SearchWebTool(IWebSearchService webSearchService)
    {
        _webSearchService = webSearchService;
    }

    public string Name => "search_web";
    public string Description => "搜索互联网获取最新信息";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public string? UsageGuideline => "用户问题涉及实时信息（新闻、行情、版本号、近期事件）或你不确定的事实时调用；纯主观问题/用户私有笔记问题不要调用。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "query": { "type": "string", "description": "搜索关键词" },
            "maxResults": { "type": "integer", "description": "最大返回结果数", "default": 5 }
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
            var maxResults = root.TryGetProperty("maxResults", out var mrProp) ? mrProp.GetInt32() : 5;

            if (string.IsNullOrWhiteSpace(query))
                return ToolExecutionResult.Error("query 参数不能为空");

            var results = await _webSearchService.SearchAsync(query, maxResults, cancellationToken);

            var output = JsonSerializer.Serialize(results.Select(r => new
            {
                title = r.Title,
                url = r.Url,
                snippet = r.Snippet
            }));

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"网页搜索失败: {ex.Message}");
        }
    }
}
