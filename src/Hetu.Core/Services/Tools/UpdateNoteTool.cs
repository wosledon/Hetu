using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services.Tools;

public class UpdateNoteTool : IToolExecutor
{
    private readonly INoteService _noteService;

    public UpdateNoteTool(INoteService noteService)
    {
        _noteService = noteService;
    }

    public string Name => "update_note";
    public string Description => "更新笔记内容";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "noteId": { "type": "string", "description": "笔记 ID" },
            "title": { "type": "string", "description": "新标题（可选）" },
            "content": { "type": "string", "description": "新内容（可选）" }
        },
        "required": ["noteId"]
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

            var request = new UpdateNoteRequest();

            if (root.TryGetProperty("title", out var titleProp) && titleProp.ValueKind == JsonValueKind.String)
                request.Title = titleProp.GetString();

            if (root.TryGetProperty("content", out var contentProp) && contentProp.ValueKind == JsonValueKind.String)
                request.Content = contentProp.GetString();

            if (request.Title == null && request.Content == null)
                return ToolExecutionResult.Error("至少需要提供 title 或 content");

            var result = await _noteService.UpdateAsync(noteId, request, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "更新笔记失败");

            var output = JsonSerializer.Serialize(new
            {
                id = result.Data.Id,
                title = result.Data.Title,
                updatedAt = result.Data.UpdatedAt
            });

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新笔记失败: {ex.Message}");
        }
    }
}
