namespace Hetu.Shared.Notifications;

/// <summary>
/// 通知级别
/// </summary>
public static class InboxLevels
{
    public const string Info = "Info";
    public const string Success = "Success";
    public const string Warning = "Warning";
    public const string Error = "Error";
}

/// <summary>
/// 预设通知类别：来源方写入时使用，前端按数据动态展示分类
/// </summary>
public static class InboxCategories
{
    public const string System = "系统";
    public const string ScheduledTask = "定时任务";
    public const string Workflow = "工作流";
    public const string KanbanTask = "看板任务";
}

/// <summary>
/// 批量操作动作
/// </summary>
public static class InboxBatchActions
{
    public const string Read = "read";
    public const string Unread = "unread";
    public const string Archive = "archive";
    public const string Unarchive = "unarchive";
    public const string Delete = "delete";
}

public class InboxNotificationDto
{
    public Guid Id { get; set; }
    public string Category { get; set; } = string.Empty;
    public string CategoryKey { get; set; } = string.Empty;
    public string Level { get; set; } = InboxLevels.Info;
    public string Title { get; set; } = string.Empty;
    public string? Content { get; set; }
    public bool IsRead { get; set; }
    public bool IsArchived { get; set; }
    public int OccurrenceCount { get; set; }
    /// <summary>点击通知跳转的应用内路径（如 /kanban/{taskId}）</summary>
    public string? Link { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// 分类聚合（含未读数，用于筛选栏）
/// </summary>
public class InboxCategoryDto
{
    public string Category { get; set; } = string.Empty;
    public int TotalCount { get; set; }
    public int UnreadCount { get; set; }
}

/// <summary>
/// 写入通知：CategoryKey 已存在且未归档时合并更新，否则新建
/// </summary>
public class CreateInboxNotificationRequest
{
    public string Category { get; set; } = InboxCategories.System;
    public string CategoryKey { get; set; } = string.Empty;
    public string Level { get; set; } = InboxLevels.Info;
    public string Title { get; set; } = string.Empty;
    public string? Content { get; set; }
    /// <summary>点击通知跳转的应用内路径（如 /kanban/{taskId}）</summary>
    public string? Link { get; set; }
}

/// <summary>
/// 标记已读/未读、归档/取消归档
/// </summary>
public class InboxStateRequest
{
    public bool Value { get; set; }
}

/// <summary>
/// 批量操作请求
/// </summary>
public class InboxBatchRequest
{
    public List<Guid> Ids { get; set; } = new();
    /// <summary>read | unread | archive | unarchive | delete</summary>
    public string Action { get; set; } = InboxBatchActions.Read;
}
