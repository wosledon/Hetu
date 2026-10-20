using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services.Tools;

public class SetNoteTagsTool : IToolExecutor
{
    private readonly ITagService _tagService;

    public SetNoteTagsTool(ITagService tagService) => _tagService = tagService;

    public string Name => "set_note_tags";
    public string Description => "设置某篇笔记的标签（整体替换，传入完整标签 ID 列表；空列表表示清空标签）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "用户要求给笔记打标签/整理标签时调用；先用 list_tags 拿到标签 ID，避免凭名称臆造 ID。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "noteId": { "type": "string", "description": "笔记 ID" },
            "tagIds": {
                "type": "array",
                "items": { "type": "string" },
                "description": "标签 ID 列表（来自 list_tags）；空数组表示清空该笔记的标签"
            }
        },
        "required": ["noteId", "tagIds"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var noteIdStr = root.GetProperty("noteId").GetString();
            if (!Guid.TryParse(noteIdStr, out var noteId))
                return ToolExecutionResult.Error("无效的笔记 ID");

            var tagIds = new List<Guid>();
            if (root.TryGetProperty("tagIds", out var tagIdsProp) &&
                tagIdsProp.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in tagIdsProp.EnumerateArray())
                {
                    if (Guid.TryParse(item.GetString(), out var tagId)) tagIds.Add(tagId);
                }
            }

            var result = await _tagService.SetNoteTagsAsync(noteId, new ManageNoteTagsRequest { TagIds = tagIds }, cancellationToken);
            if (!result.Success)
                return ToolExecutionResult.Error(result.Error ?? "设置标签失败");

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new { id = noteId, tagIds }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"设置标签失败: {ex.Message}");
        }
    }
}

public class ListTagsTool : IToolExecutor
{
    private readonly ITagService _tagService;

    public ListTagsTool(ITagService tagService) => _tagService = tagService;

    public string Name => "list_tags";
    public string Description => "查看所有标签（含各标签下的笔记数量）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户想按标签浏览、或给笔记打标签前调用本工具获取标签 ID。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {}
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _tagService.GetAllAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取标签列表失败");

            var tags = result.Data.Select(t => new
            {
                id = t.Id,
                name = t.Name,
                noteCount = t.NoteCount
            }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(tags));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取标签列表失败: {ex.Message}");
        }
    }
}
