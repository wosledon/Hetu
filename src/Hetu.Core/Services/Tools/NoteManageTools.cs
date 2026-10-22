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
    public string Description => "按条件浏览笔记列表（可按父级笔记、标签、收藏筛选），返回标题与摘要";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户说「我有哪些笔记 / 最近写了什么 / 某篇笔记下面有什么」时调用；已知标题关键词时优先 search_notes。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "parentId": { "type": "string", "description": "限定父级笔记 ID（可选，列出其子笔记）" },
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
                PageSize = Math.Clamp(ToolArgs.ReadInt(root, "limit") ?? 20, 1, 50)
            };
            if (root.TryGetProperty("parentId", out var parent) && Guid.TryParse(parent.GetString(), out var parentId))
                request.ParentId = parentId;
            if (root.TryGetProperty("tagId", out var tg) && Guid.TryParse(tg.GetString(), out var tagId))
                request.TagId = tagId;
            var favoritesOnly = ToolArgs.ReadBool(root, "favoritesOnly") ?? false;

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

    public MoveNoteTool(INoteService noteService)
    {
        _noteService = noteService;
    }

    public string Name => "move_note";
    public string Description => "把笔记移动到指定父级笔记下（或移到根级）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "用户要求整理笔记、把某篇笔记归到另一篇下面时调用；parentId 留空表示移到根级。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "noteId": { "type": "string", "description": "要移动的笔记 ID" },
            "parentId": { "type": "string", "description": "目标父级笔记 ID；留空表示移到根级" }
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

            Guid? parentId = null;
            if (root.TryGetProperty("parentId", out var parent) && !string.IsNullOrWhiteSpace(parent.GetString()))
            {
                if (!Guid.TryParse(parent.GetString(), out var parsed))
                    return ToolExecutionResult.Error("无效的父级笔记 ID");
                parentId = parsed;
            }

            var result = await _noteService.MoveAsync(noteId, new MoveNoteRequest { ParentId = parentId }, cancellationToken);
            if (!result.Success)
                return ToolExecutionResult.Error(result.Error ?? "移动笔记失败");

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new { id = noteId, parentId }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"移动笔记失败: {ex.Message}");
        }
    }
}
