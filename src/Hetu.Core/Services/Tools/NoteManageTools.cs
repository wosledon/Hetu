using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services.Tools;

/// <summary>笔记管理类工具：列表浏览、删除（回收站）、版本历史与回滚。</summary>
public class ListNotesTool : IToolExecutor
{
    private readonly INoteService _noteService;

    public ListNotesTool(INoteService noteService) => _noteService = noteService;

    public string Name => "list_notes";
    public string Description => "按条件浏览笔记列表（可按笔记本、标签、收藏筛选，或按关键词排序），返回标题与摘要";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户说「我有哪些笔记 / 最近写了什么 / 某笔记本下有什么」时调用；已知标题关键词时优先 search_notes。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "notebookId": { "type": "string", "description": "限定笔记本 ID（可选）" },
            "tagId": { "type": "string", "description": "限定标签 ID（可选）" },
            "favoritesOnly": { "type": "boolean", "description": "仅看收藏，默认 false" },
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

            var request = new GetNotesRequest
            {
                Page = 1,
                PageSize = root.TryGetProperty("limit", out var l) ? Math.Clamp(l.GetInt32(), 1, 50) : 20
            };
            if (root.TryGetProperty("notebookId", out var nb) && Guid.TryParse(nb.GetString(), out var nbId))
                request.NotebookId = nbId;
            if (root.TryGetProperty("tagId", out var tg) && Guid.TryParse(tg.GetString(), out var tagId))
                request.TagId = tagId;
            var favoritesOnly = root.TryGetProperty("favoritesOnly", out var f) && f.GetBoolean();

            var result = await _noteService.GetListAsync(request, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取笔记列表失败");

            var items = (favoritesOnly ? result.Data.Items.Where(n => n.IsFavorite) : result.Data.Items)
                .Select(n => new
                {
                    id = n.Id,
                    title = n.Title,
                    snippet = string.IsNullOrEmpty(n.Content) ? "" : n.Content[..Math.Min(120, n.Content.Length)],
                    tags = n.Tags.Select(t => t.Name),
                    isFavorite = n.IsFavorite,
                    updatedAt = n.UpdatedAt
                }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new
            {
                total = result.Data.TotalCount,
                items
            }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取笔记列表失败: {ex.Message}");
        }
    }
}

public class DeleteNoteTool : IToolExecutor
{
    private readonly INoteService _noteService;

    public DeleteNoteTool(INoteService noteService) => _noteService = noteService;

    public string Name => "delete_note";
    public string Description => "删除笔记（移入回收站，可恢复）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户明确要求删除某篇笔记时调用；删除前先向用户确认笔记标题与 ID。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "noteId": { "type": "string", "description": "要删除的笔记 ID" }
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

            var result = await _noteService.DeleteAsync(noteId, cancellationToken);
            if (!result.Success)
                return ToolExecutionResult.Error(result.Error ?? "删除笔记失败");

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new { id = noteId, deleted = true }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除笔记失败: {ex.Message}");
        }
    }
}

public class ListNoteVersionsTool : IToolExecutor
{
    private readonly INoteVersionService _noteVersionService;

    public ListNoteVersionsTool(INoteVersionService noteVersionService) => _noteVersionService = noteVersionService;

    public string Name => "list_note_versions";
    public string Description => "查看某篇笔记的历史版本列表（版本 ID 与保存时间）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户想找回旧内容、或想了解笔记被改过什么时调用；拿到版本 ID 后可配合 restore_note_version 回滚。";

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

            var result = await _noteVersionService.GetVersionsAsync(noteId, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取版本历史失败");

            var versions = result.Data.Select(v => new
            {
                id = v.Id,
                title = v.Title,
                createdAt = v.CreatedAt
            }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(versions));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取版本历史失败: {ex.Message}");
        }
    }
}

public class RestoreNoteVersionTool : IToolExecutor
{
    private readonly INoteVersionService _noteVersionService;

    public RestoreNoteVersionTool(INoteVersionService noteVersionService) => _noteVersionService = noteVersionService;

    public string Name => "restore_note_version";
    public string Description => "把笔记回滚到指定历史版本";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户确认要恢复旧版本后调用；先用 list_note_versions 取得版本 ID，回滚前告知用户将覆盖当前内容。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "versionId": { "type": "string", "description": "要恢复的版本 ID（来自 list_note_versions）" }
        },
        "required": ["versionId"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var versionIdStr = root.GetProperty("versionId").GetString();
            if (!Guid.TryParse(versionIdStr, out var versionId))
                return ToolExecutionResult.Error("无效的版本 ID");

            var result = await _noteVersionService.RestoreVersionAsync(versionId, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "恢复版本失败");

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new
            {
                id = result.Data.Id,
                title = result.Data.Title,
                restored = true
            }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"恢复版本失败: {ex.Message}");
        }
    }
}

public class MoveNoteTool : IToolExecutor
{
    private readonly INoteService _noteService;
    private readonly INotebookService _notebookService;

    public MoveNoteTool(INoteService noteService, INotebookService notebookService)
    {
        _noteService = noteService;
        _notebookService = notebookService;
    }

    public string Name => "move_note";
    public string Description => "把笔记移动到指定笔记本（或移出笔记本）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "用户要求整理笔记、把某篇笔记归类到某笔记本时调用；notebookId 留空表示移出笔记本。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "noteId": { "type": "string", "description": "要移动的笔记 ID" },
            "notebookId": { "type": "string", "description": "目标笔记本 ID；留空表示移出笔记本（未分类）" }
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

            Guid? notebookId = null;
            if (root.TryGetProperty("notebookId", out var nb) && !string.IsNullOrWhiteSpace(nb.GetString()))
            {
                if (!Guid.TryParse(nb.GetString(), out var parsed))
                    return ToolExecutionResult.Error("无效的笔记本 ID");
                var nbResult = await _notebookService.GetByIdAsync(parsed, cancellationToken);
                if (!nbResult.Success || nbResult.Data == null)
                    return ToolExecutionResult.Error("目标笔记本不存在");
                notebookId = parsed;
            }

            var result = await _noteService.MoveAsync(noteId, new MoveNoteRequest { NotebookId = notebookId }, cancellationToken);
            if (!result.Success)
                return ToolExecutionResult.Error(result.Error ?? "移动笔记失败");

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new { id = noteId, notebookId }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"移动笔记失败: {ex.Message}");
        }
    }
}
