using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>Wiki 工具：查看项目 Wiki 文档树与正文（由项目源码生成）。</summary>
public class ListWikiDocsTool : IToolExecutor
{
    private readonly IWikiService _wikiService;

    public ListWikiDocsTool(IWikiService wikiService) => _wikiService = wikiService;

    public string Name => "list_wiki_docs";
    public string Description => "列出 Wiki 文档（按项目分组：标题/类型/更新时间/所属集合）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户问「Wiki 里有什么」「某个项目的文档」时调用；拿到文档 ID 后用 read_wiki_doc 读正文。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "projectId": { "type": "string", "description": "受管项目 ID（可选，见 list_projects；不传则返回全部）" },
            "keyword": { "type": "string", "description": "按标题过滤（可选）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var projectId = CreateKanbanTaskTool.ParseGuid(ListProjectsTool.ReadString(argumentsJson, "projectId"));
            var result = await _wikiService.GetAllAsync(projectId, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取 Wiki 列表失败");

            var keyword = ListProjectsTool.ReadString(argumentsJson, "keyword");
            var items = result.Data
                .Where(d => string.IsNullOrWhiteSpace(keyword) || d.Title.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                .Select(d => new
                {
                    id = d.Id,
                    title = d.Title,
                    chapter = d.Chapter,
                    projectName = d.ProjectName,
                    setId = d.SetId,
                    updatedAt = d.UpdatedAt,
                })
                .ToList();

            return ToolExecutionResult.Success(ToolJson.Serialize(new { total = items.Count, items }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取 Wiki 列表失败: {ex.Message}");
        }
    }
}

public class ReadWikiDocTool : IToolExecutor
{
    private const int MaxBodyChars = 12_000;

    private readonly IWikiService _wikiService;

    public ReadWikiDocTool(IWikiService wikiService) => _wikiService = wikiService;

    public string Name => "read_wiki_doc";
    public string Description => "读取一篇 Wiki 文档的正文（Markdown）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "先用 list_wiki_docs 拿到文档 ID；正文过长时只引用关键段落并标注 [[Wiki 标题]]。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "id": { "type": "string", "description": "文档 ID（见 list_wiki_docs）" } },
        "required": ["id"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "id"), out var id))
                return ToolExecutionResult.Error("id 必须是有效 GUID");

            var result = await _wikiService.GetByIdAsync(id, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "文档不存在");

            var doc = result.Data;
            var body = doc.Content ?? "";
            if (body.Length > MaxBodyChars)
                body = body[..MaxBodyChars] + $"\n…（正文已截断，完整长度 {doc.Content?.Length ?? 0} 字符）";

            return ToolExecutionResult.Success(ToolJson.Serialize(new
            {
                id = doc.Id,
                title = doc.Title,
                chapter = doc.Chapter,
                projectName = doc.ProjectName,
                updatedAt = doc.UpdatedAt,
                content = body,
            }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"读取 Wiki 文档失败: {ex.Message}");
        }
    }
}
