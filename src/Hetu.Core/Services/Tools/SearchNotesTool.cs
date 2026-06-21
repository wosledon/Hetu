using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services.Tools;

public class SearchNotesTool : IToolExecutor
{
    private readonly ISearchService _searchService;
    private readonly ISemanticSearchService _semanticSearchService;

    public SearchNotesTool(ISearchService searchService, ISemanticSearchService semanticSearchService)
    {
        _searchService = searchService;
        _semanticSearchService = semanticSearchService;
    }

    public string Name => "search_notes";
    public string Description => "搜索笔记（全文+语义搜索）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "query": { "type": "string", "description": "搜索关键词" },
            "topK": { "type": "integer", "description": "返回结果数量", "default": 10 }
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
            var topK = root.TryGetProperty("topK", out var topKProp) ? topKProp.GetInt32() : 10;

            if (string.IsNullOrWhiteSpace(query))
                return ToolExecutionResult.Error("query 参数不能为空");

            var fullTextTask = _searchService.SearchNotesAsync(
                new SearchNotesRequest { Keyword = query, Page = 1, PageSize = topK }, cancellationToken);
            var semanticTask = _semanticSearchService.SearchAsync(query, topK, cancellationToken);

            await Task.WhenAll(fullTextTask, semanticTask);

            var fullTextResults = fullTextTask.Result;
            var semanticResults = semanticTask.Result;

            var merged = new Dictionary<Guid, NoteSearchResultDto>();

            if (fullTextResults is { Success: true, Data: not null })
                foreach (var item in fullTextResults.Data.Items)
                    merged.TryAdd(item.Id, item);

            if (semanticResults is { Success: true, Data: not null })
                foreach (var item in semanticResults.Data.Items)
                    merged.TryAdd(item.Id, item);

            var results = merged.Values.Take(topK).Select(r => new
            {
                id = r.Id,
                title = r.Title,
                snippet = r.ContentSnippet,
                updatedAt = r.UpdatedAt
            }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(results));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"搜索笔记失败: {ex.Message}");
        }
    }
}
