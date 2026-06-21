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

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "title": { "type": "string", "description": "笔记标题" },
            "content": { "type": "string", "description": "笔记内容" },
            "notebookId": { "type": "string", "description": "所属笔记本 ID（可选）" }
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

            if (root.TryGetProperty("notebookId", out var nbProp) && Guid.TryParse(nbProp.GetString(), out var nbId))
                request.NotebookId = nbId;

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
