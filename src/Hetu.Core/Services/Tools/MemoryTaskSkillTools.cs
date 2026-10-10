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
