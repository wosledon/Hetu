using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public class ReadNoteTool : IToolExecutor
{
    private readonly INoteService _noteService;

    public ReadNoteTool(INoteService noteService)
    {
        _noteService = noteService;
    }

    public string Name => "read_note";
    public string Description => "读取笔记内容";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "noteId": { "type": "string", "description": "笔记 ID" }
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

            var result = await _noteService.GetByIdAsync(noteId, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "笔记不存在");

            var note = result.Data;
            var output = JsonSerializer.Serialize(new
            {
                id = note.Id,
                title = note.Title,
                content = note.Content
            });

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"读取笔记失败: {ex.Message}");
        }
    }
}
