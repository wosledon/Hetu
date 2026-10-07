namespace Hetu.Core.Entities;

/// <summary>
/// 看板任务实体：个人任务看板（Todo / 任务流转）的卡片
/// </summary>
public class KanbanTask : BaseEntity
{
    /// <summary>任务标题</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>任务描述（可选）</summary>
    public string? Description { get; set; }

    /// <summary>看板列状态：Backlog / Todo / InProgress / InReview / Blocked / Done / Archived</summary>
    public string Status { get; set; } = Hetu.Shared.Tasks.KanbanTaskStatuses.Backlog;

    /// <summary>优先级：Low / Medium / High / Urgent</summary>
    public string Priority { get; set; } = Hetu.Shared.Tasks.KanbanTaskPriorities.Medium;

    /// <summary>负责人（可选）</summary>
    public string? Assignee { get; set; }

    /// <summary>标签，逗号分隔（可选）</summary>
    public string? Tags { get; set; }

    /// <summary>截止日期（可选）</summary>
    public DateTimeOffset? DueDate { get; set; }

    /// <summary>列内排序序号，越小越靠前</summary>
    public int SortOrder { get; set; }

    /// <summary>阻塞原因（Status 为 Blocked 时填写）</summary>
    public string? BlockedReason { get; set; }

    /// <summary>完成时间（Status 变为 Done 时记录）</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>归档时间（Status 变为 Archived 时记录，看板仅展示 7 天内归档）</summary>
    public DateTimeOffset? ArchivedAt { get; set; }

    /// <summary>是否软删除</summary>
    public bool IsDeleted { get; set; }
}

