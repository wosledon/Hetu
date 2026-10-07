using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>知识库工具：浏览已收录的知识项（笔记/文件/网址）。</summary>
public class ListKnowledgeItemsTool : IToolExecutor
{
    private readonly IUnitOfWork _unitOfWork;

    public ListKnowledgeItemsTool(IUnitOfWork unitOfWork) => _unitOfWork = unitOfWork;

    public string Name => "list_knowledge_items";
    public string Description => "浏览知识库中已收录的内容（笔记、文件、网址）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户问「知识库里有什么 / 收录了哪些资料」时调用；需要检索具体内容时改用 search_notes 或 search_graph。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "type": { "type": "string", "enum": ["Note", "File", "Url"], "description": "按类型过滤（可选）" },
            "limit": { "type": "integer", "description": "返回条数，默认 20，最大 50" }
        }
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var limit = root.TryGetProperty("limit", out var l) ? Math.Clamp(l.GetInt32(), 1, 50) : 20;
            var typeFilter = root.TryGetProperty("type", out var t) ? t.GetString() : null;

            var items = await _unitOfWork.KnowledgeItems.GetAllAsync(cancellationToken);
            var filtered = items.AsEnumerable();
            if (!string.IsNullOrWhiteSpace(typeFilter) &&
                Enum.TryParse<Entities.KnowledgeItemType>(typeFilter, true, out var parsed))
            {
                filtered = filtered.Where(i => i.Type == parsed);
            }

            var result = filtered
                .OrderByDescending(i => i.CreatedAt)
                .Take(limit)
                .Select(i => new
                {
                    id = i.Id,
                    title = i.Title,
                    type = i.Type.ToString(),
                    url = i.SourceUrl,
                    createdAt = i.CreatedAt
                }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(result));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取知识库列表失败: {ex.Message}");
        }
    }
}
