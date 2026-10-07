namespace Hetu.Shared.Tasks;

/// <summary>
/// 看板任务状态（对应看板列）
/// </summary>
public static class KanbanTaskStatuses
{
    public const string Backlog = "Backlog";
    public const string Todo = "Todo";
    public const string InProgress = "InProgress";
    public const string InReview = "InReview";
    public const string Blocked = "Blocked";
    public const string Done = "Done";
    public const string Archived = "Archived";

    public static readonly IReadOnlyList<string> All =
        [Backlog, Todo, InProgress, InReview, Blocked, Done, Archived];
}

/// <summary>
/// 看板任务优先级
/// </summary>
public static class KanbanTaskPriorities
{
    public const string Low = "Low";
    public const string Medium = "Medium";
    public const string High = "High";
    public const string Urgent = "Urgent";

    public static readonly IReadOnlyList<string> All = [Low, Medium, High, Urgent];
}

/// <summary>
/// 状态流转规则：定义每个状态允许移动到的目标状态。
/// 自动化规则（定时归档、到期提醒等）稍后实现，届时在 KanbanTaskService 的
/// MoveAsync 完成后以事件钩子方式触发，不改动此处静态规则。
/// </summary>
public static class KanbanTaskTransitions
{
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> Allowed = new Dictionary<string, IReadOnlyList<string>>
    {
        [KanbanTaskStatuses.Backlog] = [KanbanTaskStatuses.Todo, KanbanTaskStatuses.Archived],
        [KanbanTaskStatuses.Todo] = [KanbanTaskStatuses.InProgress, KanbanTaskStatuses.Backlog, KanbanTaskStatuses.Blocked],
        [KanbanTaskStatuses.InProgress] = [KanbanTaskStatuses.InReview, KanbanTaskStatuses.Todo, KanbanTaskStatuses.Blocked],
        [KanbanTaskStatuses.InReview] = [KanbanTaskStatuses.Done, KanbanTaskStatuses.InProgress, KanbanTaskStatuses.Blocked],
        [KanbanTaskStatuses.Blocked] = [KanbanTaskStatuses.Todo, KanbanTaskStatuses.InProgress],
        [KanbanTaskStatuses.Done] = [KanbanTaskStatuses.Archived, KanbanTaskStatuses.InReview],
        // 已归档为终态，暂不支持回流
        [KanbanTaskStatuses.Archived] = [],
    };

    public static bool IsAllowed(string from, string to)
        => Allowed.TryGetValue(from, out var targets) && targets.Contains(to);
}

public class KanbanTaskDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Status { get; set; } = KanbanTaskStatuses.Backlog;
    public string Priority { get; set; } = KanbanTaskPriorities.Medium;
    public string? Assignee { get; set; }
    public string? Tags { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public int SortOrder { get; set; }
    public string? BlockedReason { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    /// <summary>执行项目（项目管理条目）</summary>
    public Guid? ProjectId { get; set; }
    public string? ProjectName { get; set; }
    /// <summary>自动处理的智能体</summary>
    public Guid? AgentId { get; set; }
    public string? AgentName { get; set; }
    /// <summary>自动处理的工作流</summary>
    public Guid? WorkflowId { get; set; }
    public string? WorkflowName { get; set; }
    /// <summary>是否配置了自动处理（智能体或工作流）</summary>
    public bool HasAutomation => AgentId != null || WorkflowId != null;
    /// <summary>最近一次执行状态：Running / Succeeded / Failed</summary>
    public string? LastRunStatus { get; set; }
    public Guid? LastRunId { get; set; }
    public int CommentCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateKanbanTaskRequest
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Status { get; set; } = KanbanTaskStatuses.Backlog;
    public string Priority { get; set; } = KanbanTaskPriorities.Medium;
    public string? Assignee { get; set; }
    public string? Tags { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public string? BlockedReason { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? AgentId { get; set; }
    public Guid? WorkflowId { get; set; }
}

public class UpdateKanbanTaskRequest : CreateKanbanTaskRequest { }

/// <summary>流转请求：移动到目标列并指定列内位置</summary>
public class MoveKanbanTaskRequest
{
    public string Status { get; set; } = KanbanTaskStatuses.Backlog;

    /// <summary>插入到目标列的哪个任务之前；null 或 Guid.Empty 表示追加到列尾</summary>
    public Guid? BeforeTaskId { get; set; }

    /// <summary>阻塞原因（目标为 Blocked 时填写）</summary>
    public string? BlockedReason { get; set; }
}

/// <summary>任务评论（时间线条目）</summary>
public class KanbanTaskCommentDto
{
    public Guid Id { get; set; }
    public Guid TaskId { get; set; }
    /// <summary>User / Agent / System / Workflow</summary>
    public string AuthorType { get; set; } = "User";
    public string AuthorName { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public Guid? RunId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class CreateKanbanTaskCommentRequest
{
    public string Content { get; set; } = string.Empty;
    /// <summary>提交评论后是否让智能体/工作流根据评论继续处理（默认 true）</summary>
    public bool TriggerAutomation { get; set; } = true;
}

/// <summary>任务执行记录</summary>
public class KanbanTaskRunDto
{
    public Guid Id { get; set; }
    public Guid TaskId { get; set; }
    /// <summary>Agent / Workflow</summary>
    public string Kind { get; set; } = "Agent";
    /// <summary>Todo / Comment / Manual</summary>
    public string Trigger { get; set; } = "Todo";
    /// <summary>Running / Succeeded / Failed</summary>
    public string Status { get; set; } = "Running";
    public string? Output { get; set; }
    public string? Error { get; set; }
    public Guid? WorkflowRunId { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>任务详情：任务本体 + 时间线评论 + 执行记录</summary>
public class KanbanTaskDetailDto
{
    public KanbanTaskDto Task { get; set; } = new();
    public List<KanbanTaskCommentDto> Comments { get; set; } = [];
    public List<KanbanTaskRunDto> Runs { get; set; } = [];
}

public class KanbanBoardDto
{
    public List<KanbanTaskDto> Backlog { get; set; } = [];
    public List<KanbanTaskDto> Todo { get; set; } = [];
    public List<KanbanTaskDto> InProgress { get; set; } = [];
    public List<KanbanTaskDto> InReview { get; set; } = [];
    public List<KanbanTaskDto> Blocked { get; set; } = [];
    public List<KanbanTaskDto> Done { get; set; } = [];
    /// <summary>仅包含最近 7 天内归档的任务</summary>
    public List<KanbanTaskDto> Archived { get; set; } = [];
    public KanbanTaskStatsDto Stats { get; set; } = new();
}

public class KanbanTaskStatsDto
{
    public int Total { get; set; }
    public int Active { get; set; }
    public int Done { get; set; }
    public int Archived { get; set; }
    public int Overdue { get; set; }
    public int DueSoon { get; set; }
}
