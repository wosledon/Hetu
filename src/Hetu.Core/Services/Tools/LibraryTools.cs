using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services.Tools;

/// <summary>标签工具：新建、改名/改色、删除标签。</summary>
public class CreateTagTool : IToolExecutor
{
    private readonly ITagService _tagService;

    public CreateTagTool(ITagService tagService) => _tagService = tagService;

    public string Name => "create_tag";
    public string Description => "新建标签（可指定颜色）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "先用 list_tags 检查是否已有同名标签，避免重复创建。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "标签名" },
            "color": { "type": "string", "description": "颜色（可选，如 #3b82f6）" }
        },
        "required": ["name"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var name = ListProjectsTool.ReadString(argumentsJson, "name");
            if (string.IsNullOrWhiteSpace(name))
                return ToolExecutionResult.Error("name 不能为空");

            var result = await _tagService.CreateAsync(new CreateTagRequest
            {
                Name = name.Trim(),
                Color = ListProjectsTool.ReadString(argumentsJson, "color"),
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = result.Data.Id, name = result.Data.Name }))
                : ToolExecutionResult.Error(result.Error ?? "创建标签失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建标签失败: {ex.Message}");
        }
    }
}

public class UpdateTagTool : IToolExecutor
{
    private readonly ITagService _tagService;

    public UpdateTagTool(ITagService tagService) => _tagService = tagService;

    public string Name => "update_tag";
    public string Description => "修改标签名称或颜色";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "先用 list_tags 拿到标签 ID；改名会影响所有已打该标签的笔记，先与用户确认新名字。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "标签 ID（见 list_tags）" },
            "name": { "type": "string" },
            "color": { "type": "string" }
        },
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

            var current = await _tagService.GetByIdAsync(id, cancellationToken);
            if (!current.Success || current.Data == null)
                return ToolExecutionResult.Error(current.Error ?? "标签不存在");

            var result = await _tagService.UpdateAsync(id, new UpdateTagRequest
            {
                Name = ListProjectsTool.ReadString(argumentsJson, "name") ?? current.Data.Name,
                Color = ListProjectsTool.ReadString(argumentsJson, "color") ?? current.Data.Color,
            }, cancellationToken);

            return result.Success
                ? ToolExecutionResult.Success($"已更新标签「{result.Data?.Name ?? current.Data.Name}」")
                : ToolExecutionResult.Error(result.Error ?? "更新标签失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新标签失败: {ex.Message}");
        }
    }
}

public class DeleteTagTool : IToolExecutor
{
    private readonly ITagService _tagService;

    public DeleteTagTool(ITagService tagService) => _tagService = tagService;

    public string Name => "delete_tag";
    public string Description => "删除标签（只解除标签，不删除笔记）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "破坏性操作：先 ask_question 确认标签名，再删除。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "id": { "type": "string", "description": "标签 ID" } },
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

            var result = await _tagService.DeleteAsync(id, cancellationToken);
            return result.Success ? ToolExecutionResult.Success("标签已删除（笔记内容未受影响）") : ToolExecutionResult.Error(result.Error ?? "删除标签失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除标签失败: {ex.Message}");
        }
    }
}

/// <summary>知识库条目读取：按 ID 取正文（列表由 list_knowledge_items 提供）。</summary>
public class ReadKnowledgeItemTool : IToolExecutor
{
    private const int MaxBodyChars = 12_000;

    private readonly IUnitOfWork _unitOfWork;

    public ReadKnowledgeItemTool(IUnitOfWork unitOfWork) => _unitOfWork = unitOfWork;

    public string Name => "read_knowledge_item";
    public string Description => "读取知识库条目的完整内容（Markdown/纯文本）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "先用 list_knowledge_items 或语义检索拿到条目 ID；引用时标注 [[标题]]。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "id": { "type": "string", "description": "知识库条目 ID" } },
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

            var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, cancellationToken);
            if (item == null) return ToolExecutionResult.Error("知识库条目不存在");

            var content = item.Content ?? "";
            var isTruncated = content.Length > MaxBodyChars;
            if (isTruncated) content = content[..MaxBodyChars] + $"\n…（内容已截断，完整长度 {item.Content!.Length} 字符）";

            return ToolExecutionResult.Success(ToolJson.Serialize(new
            {
                id = item.Id,
                title = item.Title,
                type = item.Type.ToString(),
                source = item.SourceUrl ?? item.FileName,
                content,
            }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"读取知识库条目失败: {ex.Message}");
        }
    }
}

/// <summary>用量统计：累计消息/Token、今日用量、平均耗时与模型分布。</summary>
public class GetUsageStatsTool : IToolExecutor
{
    private readonly UsageService _usageService;

    public GetUsageStatsTool(UsageService usageService) => _usageService = usageService;

    public string Name => "get_usage_stats";
    public string Description => "查看大模型用量统计：累计与今日的消息数/Token、平均耗时、按天的趋势与模型分布";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户问「用了多少 token」「花了多少」时调用；不要在每次对话无脑附带统计。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "days": { "type": "integer", "description": "返回最近多少天的趋势（默认 7，最多 30）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var stats = await _usageService.GetStatsAsync(cancellationToken);
            var days = 7;
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
                if (doc.RootElement.TryGetProperty("days", out var d) && d.ValueKind == JsonValueKind.Number)
                    days = Math.Clamp(d.GetInt32(), 1, 30);
            }
            catch (JsonException)
            {
                // 参数非法时用默认天数
            }

            var trend = (stats.DailyTrend ?? [])
                .OrderByDescending(x => x.Date)
                .Take(days)
                .Select(x => new { date = x.Date, messages = x.Messages, tokens = x.Tokens })
                .ToList();

            var models = (stats.ByModel ?? [])
                .OrderByDescending(m => m.Tokens)
                .Take(8)
                .Select(m => new { model = m.ModelName, messages = m.Messages, tokens = m.Tokens, cachedTokens = m.CachedTokens })
                .ToList();

            var sources = (stats.BySource ?? [])
                .OrderByDescending(s => s.Tokens)
                .Select(s => new { source = s.SourceName, messages = s.Messages, tokens = s.Tokens })
                .ToList();

            return ToolExecutionResult.Success(ToolJson.Serialize(new
            {
                overview = stats.Overview,
                trend,
                models,
                sources,
            }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取用量统计失败: {ex.Message}");
        }
    }
}

/// <summary>收件箱工具：查看通知与批量已读/归档/删除。</summary>
public class ListInboxItemsTool : IToolExecutor
{
    private readonly InboxService _inboxService;

    public ListInboxItemsTool(InboxService inboxService) => _inboxService = inboxService;

    public string Name => "list_inbox_items";
    public string Description => "查看收件箱通知（系统/定时任务/工作流/看板任务），支持按分类与归档状态过滤";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户问「有什么通知」「有没有失败的定时任务」时调用；需要处理时用 update_inbox_items。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "category": { "type": "string", "description": "分类名（可选，如 系统/定时任务/工作流/看板任务）" },
            "archived": { "type": "boolean", "description": "是否查看已归档（默认 false）" },
            "limit": { "type": "integer", "description": "最多返回条数（默认 20，最多 100）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var category = ListProjectsTool.ReadString(argumentsJson, "category");
            var archived = false;
            var limit = 20;
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
                if (doc.RootElement.TryGetProperty("archived", out var a)
                    && (a.ValueKind == JsonValueKind.True || a.ValueKind == JsonValueKind.False))
                    archived = a.GetBoolean();
                if (doc.RootElement.TryGetProperty("limit", out var l) && l.ValueKind == JsonValueKind.Number)
                    limit = Math.Clamp(l.GetInt32(), 1, 100);
            }
            catch (JsonException)
            {
                // 参数非法时用默认值
            }

            var items = await _inboxService.GetAsync(category, archived, 1, limit, cancellationToken);
            var unread = await _inboxService.GetUnreadCountAsync(cancellationToken);

            return ToolExecutionResult.Success(ToolJson.Serialize(new
            {
                unreadCount = unread,
                total = items.Count,
                items = items.Select(n => new
                {
                    id = n.Id,
                    category = n.Category,
                    level = n.Level,
                    title = n.Title,
                    content = n.Content,
                    isRead = n.IsRead,
                    occurrenceCount = n.OccurrenceCount,
                    link = n.Link,
                    createdAt = n.CreatedAt,
                }),
            }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取收件箱失败: {ex.Message}");
        }
    }
}

public class UpdateInboxItemsTool : IToolExecutor
{
    private readonly InboxService _inboxService;

    public UpdateInboxItemsTool(InboxService inboxService) => _inboxService = inboxService;

    public string Name => "update_inbox_items";
    public string Description => "批量处理收件箱通知：标记已读/未读、归档/取消归档、删除";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "删除通知前先 ask_question 确认；只读类操作（标记已读）可直接执行。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "ids": { "type": "array", "items": { "type": "string" }, "description": "通知 ID 列表（见 list_inbox_items）" },
            "action": { "type": "string", "description": "read | unread | archive | unarchive | delete" }
        },
        "required": ["ids", "action"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var action = ListProjectsTool.ReadString(argumentsJson, "action");
            if (string.IsNullOrWhiteSpace(action))
                return ToolExecutionResult.Error("action 不能为空");

            var ids = new List<Guid>();
            using (var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson))
            {
                if (doc.RootElement.TryGetProperty("ids", out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in arr.EnumerateArray())
                    {
                        if (el.ValueKind == JsonValueKind.String && Guid.TryParse(el.GetString(), out var id))
                            ids.Add(id);
                    }
                }
            }
            if (ids.Count == 0) return ToolExecutionResult.Error("ids 不能为空");

            var result = await _inboxService.BatchAsync(new Hetu.Shared.Notifications.InboxBatchRequest
            {
                Ids = ids,
                Action = action.Trim().ToLowerInvariant(),
            }, cancellationToken);

            return result.Success
                ? ToolExecutionResult.Success($"已处理 {result.Data} 条通知（{action}）")
                : ToolExecutionResult.Error(result.Error ?? "处理通知失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"处理通知失败: {ex.Message}");
        }
    }
}
