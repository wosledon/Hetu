using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Chat;
using Hetu.Shared.Tasks;

namespace Hetu.Core.Services.Tools;

/// <summary>记忆管理工具：浏览与删除长期记忆。</summary>
public class ListMemoriesTool : IToolExecutor
{
    private readonly IMemoryService _memoryService;

    public ListMemoriesTool(IMemoryService memoryService) => _memoryService = memoryService;

    public string Name => "list_memories";
    public string Description => "浏览长期记忆列表（按作用域/分类查看：Global 全局 / Session 会话 / Project 项目内）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户问「你记得我什么 / 我的偏好设置 / 这个项目的约定」时调用；需要语义检索时改用 search_memory。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "category": { "type": "string", "description": "按分类过滤（可选，如 preference、fact、habit）" },
            "scope": { "type": "string", "description": "按作用域过滤（可选）：Global | Session | Project" },
            "projectId": { "type": "string", "description": "按项目过滤（可选，配合 scope=Project）" },
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

            var limit = root.TryGetProperty("limit", out var l) ? Math.Clamp(l.GetInt32(), 1, 50) : 20;
            var category = root.TryGetProperty("category", out var c) ? c.GetString() : null;
            var scope = root.TryGetProperty("scope", out var s) ? s.GetString() : null;
            var projectId = root.TryGetProperty("projectId", out var p) && Guid.TryParse(p.GetString(), out var pid) ? pid : (Guid?)null;

            var result = await _memoryService.GetAllAsync(1, limit, scope, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取记忆列表失败");

            var items = result.Data.Items
                .Where(m => string.IsNullOrEmpty(category) || string.Equals(m.Category, category, StringComparison.OrdinalIgnoreCase))
                .Where(m => projectId == null || m.ProjectId == projectId)
                .Select(m => new
                {
                    id = m.Id,
                    content = m.Content,
                    scope = m.Scope,
                    projectName = m.ProjectName,
                    category = m.Category,
                    importance = m.Importance,
                    lastAccessedAt = m.LastAccessedAt,
                    createdAt = m.CreatedAt
                }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new
            {
                total = result.Data.TotalCount,
                items
            }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取记忆列表失败: {ex.Message}");
        }
    }
}

public class DeleteMemoryTool : IToolExecutor
{
    private readonly IMemoryService _memoryService;

    public DeleteMemoryTool(IMemoryService memoryService) => _memoryService = memoryService;

    public string Name => "delete_memory";
    public string Description => "删除一条长期记忆";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户明确要求忘掉某件事/删除某条记忆时调用；删除前先向用户复述记忆内容确认。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "memoryId": { "type": "string", "description": "要删除的记忆 ID" }
        },
        "required": ["memoryId"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var memoryIdStr = root.GetProperty("memoryId").GetString();
            if (!Guid.TryParse(memoryIdStr, out var memoryId))
                return ToolExecutionResult.Error("无效的记忆 ID");

            var result = await _memoryService.DeleteAsync(memoryId, cancellationToken);
            if (!result.Success)
                return ToolExecutionResult.Error(result.Error ?? "删除记忆失败");

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new { id = memoryId, deleted = true }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除记忆失败: {ex.Message}");
        }
    }
}

/// <summary>定时任务管理工具：查看与删除定时任务。</summary>
public class ListScheduledTasksTool : IToolExecutor
{
    private readonly IScheduledTaskService _scheduledTaskService;

    public ListScheduledTasksTool(IScheduledTaskService scheduledTaskService) => _scheduledTaskService = scheduledTaskService;

    public string Name => "list_scheduled_tasks";
    public string Description => "查看所有定时任务（名称、类型、调度周期、启用状态、下次运行时间、上次结果）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户询问有哪些定时/自动任务、或任务上次为什么没成功时调用。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "enabledOnly": { "type": "boolean", "description": "仅看已启用任务，默认 false" }
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
            var enabledOnly = root.TryGetProperty("enabledOnly", out var e) && e.GetBoolean();

            var result = await _scheduledTaskService.GetAllAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取定时任务失败");

            var tasks = result.Data
                .Where(t => !enabledOnly || t.IsEnabled)
                .Select(t => new
                {
                    id = t.Id,
                    name = t.Name,
                    taskKind = t.TaskKind,
                    targetName = t.TargetName,
                    scheduleType = t.ScheduleType,
                    intervalMinutes = t.IntervalMinutes,
                    cronExpression = t.CronExpression,
                    isEnabled = t.IsEnabled,
                    nextRunAt = t.NextRunAt,
                    lastRunAt = t.LastRunAt,
                    lastStatus = t.LastStatus,
                    lastError = t.LastError
                }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(tasks));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取定时任务失败: {ex.Message}");
        }
    }
}

public class DeleteScheduledTaskTool : IToolExecutor
{
    private readonly IScheduledTaskService _scheduledTaskService;

    public DeleteScheduledTaskTool(IScheduledTaskService scheduledTaskService) => _scheduledTaskService = scheduledTaskService;

    public string Name => "delete_scheduled_task";
    public string Description => "删除一个定时任务";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户明确要求取消/删除某个定时任务时调用；先用 list_scheduled_tasks 确认目标任务，删除前告知任务名称。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "taskId": { "type": "string", "description": "要删除的任务 ID" }
        },
        "required": ["taskId"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var taskIdStr = root.GetProperty("taskId").GetString();
            if (!Guid.TryParse(taskIdStr, out var taskId))
                return ToolExecutionResult.Error("无效的任务 ID");

            var result = await _scheduledTaskService.DeleteAsync(taskId, cancellationToken);
            if (!result.Success)
                return ToolExecutionResult.Error(result.Error ?? "删除定时任务失败");

            return ToolExecutionResult.Success(JsonSerializer.Serialize(new { id = taskId, deleted = true }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除定时任务失败: {ex.Message}");
        }
    }
}

/// <summary>修改定时任务：未传字段保持原值（含启用状态与会话绑定）。</summary>
public class UpdateScheduledTaskTool : IToolExecutor
{
    private readonly IScheduledTaskService _scheduledTaskService;
    private readonly ILocalSkillService _localSkillService;

    public UpdateScheduledTaskTool(IScheduledTaskService scheduledTaskService, ILocalSkillService localSkillService)
    {
        _scheduledTaskService = scheduledTaskService;
        _localSkillService = localSkillService;
    }

    public string Name => "update_scheduled_task";
    public string Description => "修改定时任务：名称、说明、任务类型、执行目标、调度周期（间隔或 Cron）、最大重试次数";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "先用 list_scheduled_tasks 拿到任务 ID；只传需要改动的字段，未传字段保持原值（启用状态与会话绑定不受影响）。改调度会重算下次运行时间；停用/启用任务用 toggle_scheduled_task。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "taskId": { "type": "string", "description": "任务 ID（见 list_scheduled_tasks）" },
            "name": { "type": "string", "description": "任务名称（可选）" },
            "description": { "type": "string", "description": "任务描述（可选；传空串清除）" },
            "taskKind": { "type": "string", "description": "Skill | AiTask | GraphRebuild | EmbeddingRegenerate" },
            "targetId": { "type": "string", "description": "目标技能 ID（taskKind=Skill 时需要，见 list_skills）" },
            "parameters": { "type": "string", "description": "Skill=输入内容; AiTask=JSON {systemPrompt, prompt}; 其余留空" },
            "scheduleType": { "type": "string", "description": "Interval（固定间隔）| Cron（Cron 表达式）" },
            "intervalMinutes": { "type": "integer", "description": "间隔分钟数（scheduleType=Interval 时需要）" },
            "cronExpression": { "type": "string", "description": "Cron 表达式，5 段：分 时 日 月 周（scheduleType=Cron 时需要，如 '0 8 * * *' 每天 8 点）" },
            "maxRetries": { "type": "integer", "description": "最大重试次数，默认 0（不重试）" }
        },
        "required": ["taskId"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "taskId"), out var taskId))
                return ToolExecutionResult.Error("taskId 必须是有效 GUID");

            var current = await _scheduledTaskService.GetByIdAsync(taskId, cancellationToken);
            if (!current.Success || current.Data == null)
                return ToolExecutionResult.Error(current.Error ?? "定时任务不存在");

            var task = current.Data;
            var taskKind = ToolArgs.Has(argumentsJson, "taskKind")
                ? (ListProjectsTool.ReadString(argumentsJson, "taskKind") ?? task.TaskKind)
                : task.TaskKind;
            var targetId = ToolArgs.Has(argumentsJson, "targetId")
                ? ListProjectsTool.ReadString(argumentsJson, "targetId")
                : task.TargetId;

            var result = await _scheduledTaskService.UpdateAsync(taskId, new UpdateScheduledTaskRequest
            {
                // 服务端按整条记录覆盖：未传字段沿用现值，IsEnabled 与 TopicId（会话绑定）必须显式带回
                Name = ListProjectsTool.ReadString(argumentsJson, "name") ?? task.Name,
                Description = ToolArgs.Has(argumentsJson, "description")
                    ? ListProjectsTool.ReadString(argumentsJson, "description")
                    : task.Description,
                TaskKind = taskKind,
                TargetId = targetId,
                TargetName = taskKind == ScheduledTaskKinds.Skill && !string.IsNullOrEmpty(targetId)
                    ? await ScheduledTaskSkillNames.ResolveAsync(_localSkillService, targetId, cancellationToken)
                    : null,
                Parameters = ToolArgs.Has(argumentsJson, "parameters")
                    ? ListProjectsTool.ReadString(argumentsJson, "parameters")
                    : task.Parameters,
                ScheduleType = ToolArgs.Has(argumentsJson, "scheduleType")
                    ? (ListProjectsTool.ReadString(argumentsJson, "scheduleType") ?? task.ScheduleType)
                    : task.ScheduleType,
                IntervalMinutes = ToolArgs.ReadInt(argumentsJson, "intervalMinutes") ?? task.IntervalMinutes,
                CronExpression = ToolArgs.Has(argumentsJson, "cronExpression")
                    ? ListProjectsTool.ReadString(argumentsJson, "cronExpression")
                    : task.CronExpression,
                IsEnabled = task.IsEnabled,
                MaxRetries = ToolArgs.ReadInt(argumentsJson, "maxRetries") ?? task.MaxRetries,
                TopicId = task.TopicId,
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    taskKind = result.Data.TaskKind,
                    scheduleType = result.Data.ScheduleType,
                    intervalMinutes = result.Data.IntervalMinutes,
                    cronExpression = result.Data.CronExpression,
                    isEnabled = result.Data.IsEnabled,
                    nextRunAt = result.Data.NextRunAt,
                }))
                : ToolExecutionResult.Error(result.Error ?? "更新定时任务失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新定时任务失败: {ex.Message}");
        }
    }
}

/// <summary>启用 / 停用定时任务（停用后不再自动执行，历史保留）。</summary>
public class ToggleScheduledTaskTool : IToolExecutor
{
    private readonly IScheduledTaskService _scheduledTaskService;

    public ToggleScheduledTaskTool(IScheduledTaskService scheduledTaskService) => _scheduledTaskService = scheduledTaskService;

    public string Name => "toggle_scheduled_task";
    public string Description => "启用或停用一个定时任务（停用后不再自动执行，任务与历史保留）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "用户要求「暂停/停用/启用/恢复」某个定时任务时调用；enabled 不传则取反当前状态。先用 list_scheduled_tasks 确认任务 ID。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "taskId": { "type": "string", "description": "任务 ID（见 list_scheduled_tasks）" },
            "enabled": { "type": "boolean", "description": "目标状态：true 启用 / false 停用；不传则取反当前状态" }
        },
        "required": ["taskId"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "taskId"), out var taskId))
                return ToolExecutionResult.Error("taskId 必须是有效 GUID");

            var current = await _scheduledTaskService.GetByIdAsync(taskId, cancellationToken);
            if (!current.Success || current.Data == null)
                return ToolExecutionResult.Error(current.Error ?? "定时任务不存在");

            var task = current.Data;
            var target = ToolArgs.ReadBool(argumentsJson, "enabled") ?? !task.IsEnabled;
            if (task.IsEnabled == target)
                return ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = task.Id,
                    name = task.Name,
                    isEnabled = task.IsEnabled,
                    changed = false,
                }));

            var result = await _scheduledTaskService.ToggleAsync(taskId, cancellationToken);
            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    isEnabled = result.Data.IsEnabled,
                    nextRunAt = result.Data.NextRunAt,
                    changed = true,
                }))
                : ToolExecutionResult.Error(result.Error ?? "切换定时任务状态失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"切换定时任务状态失败: {ex.Message}");
        }
    }
}

/// <summary>立即执行一次定时任务（不改动原调度周期）。</summary>
public class RunScheduledTaskTool : IToolExecutor
{
    private readonly IScheduledTaskService _scheduledTaskService;

    public RunScheduledTaskTool(IScheduledTaskService scheduledTaskService) => _scheduledTaskService = scheduledTaskService;

    public string Name => "run_scheduled_task";
    public string Description => "立即执行一次定时任务（不影响原调度周期，结果记录在任务历史）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户要求「现在就跑一次」某个定时任务时调用；先用 list_scheduled_tasks 确认任务 ID。执行异步进行，结果稍后在任务历史中查看。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "taskId": { "type": "string", "description": "任务 ID（见 list_scheduled_tasks）" }
        },
        "required": ["taskId"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "taskId"), out var taskId))
                return ToolExecutionResult.Error("taskId 必须是有效 GUID");

            var current = await _scheduledTaskService.GetByIdAsync(taskId, cancellationToken);
            if (!current.Success || current.Data == null)
                return ToolExecutionResult.Error(current.Error ?? "定时任务不存在");

            var result = await _scheduledTaskService.RunNowAsync(taskId, cancellationToken);
            return result.Success
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = taskId,
                    name = current.Data.Name,
                    status = result.Data?.Status,
                    startedAt = result.Data?.StartedAt,
                }))
                : ToolExecutionResult.Error(result.Error ?? "触发定时任务执行失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"触发定时任务执行失败: {ex.Message}");
        }
    }
}

/// <summary>修改一条长期记忆：未传字段保持原值。</summary>
public class UpdateMemoryTool : IToolExecutor
{
    private readonly IMemoryService _memoryService;

    public UpdateMemoryTool(IMemoryService memoryService) => _memoryService = memoryService;

    public string Name => "update_memory";
    public string Description => "修改一条长期记忆的内容、分类、作用域或重要度";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "记忆内容过时或用户纠正某条记忆时调用；先用 search_memory / list_memories 拿到记忆 ID，只传需要改动的字段，未传字段保持原值。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "memoryId": { "type": "string", "description": "记忆 ID（见 list_memories / search_memory）" },
            "content": { "type": "string", "description": "新的记忆内容（可选）" },
            "category": { "type": "string", "description": "分类（可选；传空串清除）" },
            "scope": { "type": "string", "description": "作用域：Global | Project；会话记忆由系统管理" },
            "projectId": { "type": "string", "description": "scope=Project 时的受管项目 ID（见 list_projects）" },
            "importance": { "type": "number", "description": "重要度 0~1（可选）" }
        },
        "required": ["memoryId"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "memoryId"), out var memoryId))
                return ToolExecutionResult.Error("memoryId 必须是有效 GUID");

            var current = await _memoryService.GetByIdAsync(memoryId, cancellationToken);
            if (!current.Success || current.Data == null)
                return ToolExecutionResult.Error(current.Error ?? "记忆不存在");

            var memory = current.Data;
            // 分类：显式传空串 / 空白表示清除
            var category = ToolArgs.Has(argumentsJson, "category")
                ? ListProjectsTool.ReadString(argumentsJson, "category")
                : memory.Category;

            var result = await _memoryService.UpdateAsync(memoryId, new UpdateMemoryRequest
            {
                // 服务端按整条记录覆盖：未传字段沿用现值
                Content = ListProjectsTool.ReadString(argumentsJson, "content") ?? memory.Content,
                Category = string.IsNullOrWhiteSpace(category) ? null : category,
                Importance = (float)(ToolArgs.ReadDouble(argumentsJson, "importance") ?? memory.Importance),
                Scope = ListProjectsTool.ReadString(argumentsJson, "scope") ?? memory.Scope,
                ProjectId = ListProjectsTool.ReadString(argumentsJson, "projectId") is { Length: > 0 } pid && Guid.TryParse(pid, out var gid)
                    ? gid
                    : memory.ProjectId,
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    content = result.Data.Content,
                    category = result.Data.Category,
                    scope = result.Data.Scope,
                    importance = result.Data.Importance,
                    projectName = result.Data.ProjectName,
                }))
                : ToolExecutionResult.Error(result.Error ?? "更新记忆失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新记忆失败: {ex.Message}");
        }
    }
}

/// <summary>手动执行一次 Dream 记忆巩固：合并相似记忆 → 衰减久未想起的 → 遗忘极弱的。</summary>
public class DreamMemoryTool : IToolExecutor
{
    private readonly IMemoryService _memoryService;

    public DreamMemoryTool(IMemoryService memoryService) => _memoryService = memoryService;

    public string Name => "dream_memory";
    public string Description => "执行一次记忆整理（Dream）：合并重复记忆、衰减久未想起的、遗忘极弱的";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户要求「整理一下记忆 / 让记忆沉淀一下」时调用；会合并与遗忘记忆，先与用户说明影响再执行。";

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
            var result = await _memoryService.DreamConsolidateAsync(cancellationToken);
            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    merged = result.Data.Merged,
                    decayed = result.Data.Decayed,
                    forgotten = result.Data.Forgotten,
                    remaining = result.Data.Remaining,
                    durationMs = result.Data.DurationMs,
                }))
                : ToolExecutionResult.Error(result.Error ?? "记忆整理失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"记忆整理失败: {ex.Message}");
        }
    }
}

/// <summary>技能工具：列出本地可用的技能（供对话中按需选用）。</summary>
public class ListSkillsTool : IToolExecutor
{
    private readonly ILocalSkillService _localSkillService;

    public ListSkillsTool(ILocalSkillService localSkillService) => _localSkillService = localSkillService;

    public string Name => "list_skills";
    public string Description => "列出本地已配置的全部技能（名称、描述、分类），用于按技能执行专项任务";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户要求「用某个技能 / 执行 XX 技能」时先调用本工具拿到技能 ID；创建定时执行技能的任务时也需要技能 ID。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "keyword": { "type": "string", "description": "按名称或描述过滤（可选）" }
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
            var keyword = root.TryGetProperty("keyword", out var k) ? k.GetString() : null;

            var result = await _localSkillService.ScanAllAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取技能列表失败");

            var skills = result.Data
                .Where(s => s.IsEnabled)
                .Where(s => string.IsNullOrEmpty(keyword) ||
                            s.Name.Contains(keyword, StringComparison.OrdinalIgnoreCase) ||
                            s.Description.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                .Select(s => new
                {
                    id = s.Id,
                    name = s.Name,
                    description = s.Description,
                    category = s.Category
                }).ToList();

            return ToolExecutionResult.Success(JsonSerializer.Serialize(skills));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取技能列表失败: {ex.Message}");
        }
    }
}
