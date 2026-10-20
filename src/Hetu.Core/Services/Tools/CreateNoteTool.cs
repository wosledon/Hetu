using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services.Tools;

public class CreateNoteTool : IToolExecutor
{
    private readonly INoteService _noteService;

    public CreateNoteTool(INoteService noteService)
    {
        _noteService = noteService;
    }

    public string Name => "create_note";
    public string Description => "创建新笔记";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "仅在用户明确要求「保存/记下/整理为笔记」时调用；先用 search_notes 确认无重复笔记。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "title": { "type": "string", "description": "笔记标题" },
            "content": { "type": "string", "description": "笔记内容" },
            "parentId": { "type": "string", "description": "父级笔记 ID（可选，创建子笔记时使用）" },
            "icon": { "type": "string", "description": "笔记图标（emoji，可选）" }
        },
        "required": ["title", "content"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var title = root.GetProperty("title").GetString() ?? "";
            var content = root.GetProperty("content").GetString() ?? "";

            if (string.IsNullOrWhiteSpace(title))
                return ToolExecutionResult.Error("标题不能为空");

            var request = new CreateNoteRequest
            {
                Title = title,
                Content = content
            };

            if (root.TryGetProperty("parentId", out var parentProp) && Guid.TryParse(parentProp.GetString(), out var parentId))
                request.ParentId = parentId;
            if (root.TryGetProperty("icon", out var iconProp))
                request.Icon = iconProp.GetString();

            var result = await _noteService.CreateAsync(request, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "创建笔记失败");

            var output = JsonSerializer.Serialize(new
            {
                id = result.Data.Id,
                title = result.Data.Title
            });

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建笔记失败: {ex.Message}");
        }
    }
}
