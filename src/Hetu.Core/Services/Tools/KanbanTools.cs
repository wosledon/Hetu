using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Tasks;
using Microsoft.Extensions.DependencyInjection;

namespace Hetu.Core.Services.Tools;

/// <summary>任务看板工具：看板列/卡片查询与增删改、状态流转。</summary>
public class ListKanbanTasksTool : IToolExecutor
{
    private readonly IServiceProvider _services;

    /// <summary>
    /// 延迟解析看板服务：看板服务依赖任务执行器，执行器又依赖 ToolRegistry，
    /// 构造期直接注入会形成循环依赖。
    /// </summary>
    public ListKanbanTasksTool(IServiceProvider services) => _services = services;

    public string Name => "list_kanban_tasks";
    public string Description => "查看任务看板（按列分组的卡片：标题/状态/优先级/负责人/截止时间/关联项目）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户提到任务、待办、看板、进度时先调用本工具；卡片状态取值 Backlog/Todo/InProgress/InReview/Blocked/Done/Archived。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "status": { "type": "string", "description": "只看某一列（可选）：Backlog | Todo | InProgress | InReview | Blocked | Done | Archived" },
            "keyword": { "type": "string", "description": "按标题过滤（可选）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _services.GetRequiredService<IKanbanTaskService>().GetBoardAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取任务看板失败");

            var board = result.Data;
            var columns = new Dictionary<string, List<KanbanTaskDto>>(StringComparer.OrdinalIgnoreCase)
            {
                [KanbanTaskStatuses.Backlog] = board.Backlog,
                [KanbanTaskStatuses.Todo] = board.Todo,
                [KanbanTaskStatuses.InProgress] = board.InProgress,
                [KanbanTaskStatuses.InReview] = board.InReview,
                [KanbanTaskStatuses.Blocked] = board.Blocked,
                [KanbanTaskStatuses.Done] = board.Done,
                [KanbanTaskStatuses.Archived] = board.Archived,
            };

            var status = ListProjectsTool.ReadString(argumentsJson, "status");
            var keyword = ListProjectsTool.ReadString(argumentsJson, "keyword");

            var cards = columns
                .Where(kv => string.IsNullOrWhiteSpace(status) || kv.Key.Equals(status, StringComparison.OrdinalIgnoreCase))
                .SelectMany(kv => kv.Value.Select(t => new { column = kv.Key, task = t }))
                .Where(x => string.IsNullOrWhiteSpace(keyword) || x.task.Title.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                .Select(x => new
                {
                    id = x.task.Id,
                    title = x.task.Title,
                    status = x.task.Status,
                    priority = x.task.Priority,
                    assignee = x.task.Assignee,
                    projectName = x.task.ProjectName,
                    dueDate = x.task.DueDate,
                    lastRunStatus = x.task.LastRunStatus,
                    updatedAt = x.task.UpdatedAt,
                })
                .ToList();

            return ToolExecutionResult.Success(ToolJson.Serialize(new { total = cards.Count, items = cards }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取任务看板失败: {ex.Message}");
        }
    }
}

public class CreateKanbanTaskTool : IToolExecutor
{
    private readonly IServiceProvider _services;

    /// <summary>
    /// 延迟解析看板服务：看板服务依赖任务执行器，执行器又依赖 ToolRegistry，
    /// 构造期直接注入会形成循环依赖。
    /// </summary>
    public CreateKanbanTaskTool(IServiceProvider services) => _services = services;

    public string Name => "create_kanban_task";
    public string Description => "在看板新建任务卡片（可指定列、优先级、负责人、截止时间、关联项目）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "默认落在 Backlog 列；用户没指定优先级时用 Medium，不要擅自指派负责人。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "title": { "type": "string", "description": "任务标题" },
            "description": { "type": "string" },
            "status": { "type": "string", "description": "Backlog | Todo | InProgress | InReview | Blocked | Done（默认 Backlog）" },
            "priority": { "type": "string", "description": "Low | Medium | High | Urgent（默认 Medium）" },
            "assignee": { "type": "string" },
            "tags": { "type": "string", "description": "标签，逗号分隔" },
            "dueDate": { "type": "string", "description": "ISO 8601 截止时间（可选）" },
            "projectId": { "type": "string", "description": "关联的受管项目 ID（可选，见 list_projects）" }
        },
        "required": ["title"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var title = ListProjectsTool.ReadString(argumentsJson, "title");
            if (string.IsNullOrWhiteSpace(title))
                return ToolExecutionResult.Error("title 不能为空");

            var request = new CreateKanbanTaskRequest
            {
                Title = title.Trim(),
                Description = ListProjectsTool.ReadString(argumentsJson, "description"),
                Status = ListProjectsTool.ReadString(argumentsJson, "status") ?? KanbanTaskStatuses.Backlog,
                Priority = ListProjectsTool.ReadString(argumentsJson, "priority") ?? KanbanTaskPriorities.Medium,
                Assignee = ListProjectsTool.ReadString(argumentsJson, "assignee"),
                Tags = ListProjectsTool.ReadString(argumentsJson, "tags"),
                ProjectId = ParseGuid(ListProjectsTool.ReadString(argumentsJson, "projectId")),
                DueDate = ParseDate(ListProjectsTool.ReadString(argumentsJson, "dueDate")),
            };

            var result = await _services.GetRequiredService<IKanbanTaskService>().CreateAsync(request, cancellationToken);
            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = result.Data.Id, title = result.Data.Title, status = result.Data.Status }))
                : ToolExecutionResult.Error(result.Error ?? "创建任务失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建任务失败: {ex.Message}");
        }
    }

    internal static Guid? ParseGuid(string? raw) => Guid.TryParse(raw, out var id) ? id : null;

    internal static DateTimeOffset? ParseDate(string? raw)
        => !string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(raw, out var d) ? d : null;
}

public class UpdateKanbanTaskTool : IToolExecutor
{
    private readonly IServiceProvider _services;

    /// <summary>
    /// 延迟解析看板服务：看板服务依赖任务执行器，执行器又依赖 ToolRegistry，
    /// 构造期直接注入会形成循环依赖。
    /// </summary>
    public UpdateKanbanTaskTool(IServiceProvider services) => _services = services;

    public string Name => "update_kanban_task";
    public string Description => "修改看板任务：标题、描述、优先级、负责人、标签、截止时间、阻塞原因";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "先用 list_kanban_tasks 拿到任务 ID 与当前字段；只传需要改的字段，其余保持原值。流转列请用 move_kanban_task。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "任务 ID" },
            "title": { "type": "string" },
            "description": { "type": "string" },
            "priority": { "type": "string", "description": "Low | Medium | High | Urgent" },
            "assignee": { "type": "string" },
            "tags": { "type": "string" },
            "dueDate": { "type": "string", "description": "ISO 8601" },
            "blockedReason": { "type": "string" }
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

            var current = await _services.GetRequiredService<IKanbanTaskService>().GetByIdAsync(id, cancellationToken);
            if (!current.Success || current.Data == null)
                return ToolExecutionResult.Error(current.Error ?? "任务不存在");
            var t = current.Data;

            var result = await _services.GetRequiredService<IKanbanTaskService>().UpdateAsync(id, new UpdateKanbanTaskRequest
            {
                Title = ListProjectsTool.ReadString(argumentsJson, "title") ?? t.Title,
                Description = ListProjectsTool.ReadString(argumentsJson, "description") ?? t.Description,
                Status = t.Status,
                Priority = ListProjectsTool.ReadString(argumentsJson, "priority") ?? t.Priority,
                Assignee = ListProjectsTool.ReadString(argumentsJson, "assignee") ?? t.Assignee,
                Tags = ListProjectsTool.ReadString(argumentsJson, "tags") ?? t.Tags,
                DueDate = CreateKanbanTaskTool.ParseDate(ListProjectsTool.ReadString(argumentsJson, "dueDate")) ?? t.DueDate,
                BlockedReason = ListProjectsTool.ReadString(argumentsJson, "blockedReason") ?? t.BlockedReason,
                ProjectId = t.ProjectId,
                AgentId = t.AgentId,
                WorkflowId = t.WorkflowId,
            }, cancellationToken);

            return result.Success
                ? ToolExecutionResult.Success($"已更新任务「{result.Data?.Title ?? t.Title}」")
                : ToolExecutionResult.Error(result.Error ?? "更新任务失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新任务失败: {ex.Message}");
        }
    }
}

public class MoveKanbanTaskTool : IToolExecutor
{
    private readonly IServiceProvider _services;

    /// <summary>
    /// 延迟解析看板服务：看板服务依赖任务执行器，执行器又依赖 ToolRegistry，
    /// 构造期直接注入会形成循环依赖。
    /// </summary>
    public MoveKanbanTaskTool(IServiceProvider services) => _services = services;

    public string Name => "move_kanban_task";
    public string Description => "把任务卡片流转到目标列（可附阻塞原因）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "目标为 Done 视为完成；目标为 Blocked 时必须给出 blockedReason。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "任务 ID" },
            "status": { "type": "string", "description": "目标列：Backlog | Todo | InProgress | InReview | Blocked | Done | Archived" },
            "blockedReason": { "type": "string", "description": "目标为 Blocked 时必填" }
        },
        "required": ["id", "status"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "id"), out var id))
                return ToolExecutionResult.Error("id 必须是有效 GUID");
            var status = ListProjectsTool.ReadString(argumentsJson, "status");
            if (string.IsNullOrWhiteSpace(status))
                return ToolExecutionResult.Error("status 不能为空");

            var result = await _services.GetRequiredService<IKanbanTaskService>().MoveAsync(id, new MoveKanbanTaskRequest
            {
                Status = status.Trim(),
                BlockedReason = ListProjectsTool.ReadString(argumentsJson, "blockedReason"),
            }, cancellationToken);

            return result.Success
                ? ToolExecutionResult.Success($"任务已移动到 {result.Data?.Status ?? status}")
                : ToolExecutionResult.Error(result.Error ?? "流转任务失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"流转任务失败: {ex.Message}");
        }
    }
}

public class DeleteKanbanTaskTool : IToolExecutor
{
    private readonly IServiceProvider _services;

    /// <summary>
    /// 延迟解析看板服务：看板服务依赖任务执行器，执行器又依赖 ToolRegistry，
    /// 构造期直接注入会形成循环依赖。
    /// </summary>
    public DeleteKanbanTaskTool(IServiceProvider services) => _services = services;

    public string Name => "delete_kanban_task";
    public string Description => "删除看板任务卡片";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "破坏性操作：先用 ask_question 与用户确认任务标题，再删除。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "id": { "type": "string", "description": "任务 ID" } },
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

            var result = await _services.GetRequiredService<IKanbanTaskService>().DeleteAsync(id, cancellationToken);
            return result.Success ? ToolExecutionResult.Success("任务已删除") : ToolExecutionResult.Error(result.Error ?? "删除任务失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除任务失败: {ex.Message}");
        }
    }
}
