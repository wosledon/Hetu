namespace Hetu.Core.Entities;

/// <summary>
/// 收件箱通知：按类别聚合（相同 <see cref="CategoryKey"/> 只写入同一条，如同一定时任务的执行结果），
/// 支持已读 / 归档 / 批量操作
/// </summary>
public class InboxNotification : BaseEntity
{
    /// <summary>展示类别（如 定时任务 / 工作流 / 系统）</summary>
    public string Category { get; set; } = string.Empty;

    /// <summary>
    /// 合并键：非空时，相同键且未归档的通知会合并到同一条而非新建（如 scheduled-task:{任务Id}）
    /// </summary>
    public string CategoryKey { get; set; } = string.Empty;

    /// <summary>级别：Info | Success | Warning | Error</summary>
    public string Level { get; set; } = Hetu.Shared.Notifications.InboxLevels.Info;

    /// <summary>标题</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>正文（可选）</summary>
    public string? Content { get; set; }

    /// <summary>是否已读</summary>
    public bool IsRead { get; set; }

    /// <summary>是否已归档</summary>
    public bool IsArchived { get; set; }

    /// <summary>合并次数：同一合并键累计触达次数（首次为 1）</summary>
    public int OccurrenceCount { get; set; } = 1;

    /// <summary>点击通知跳转的应用内路径（如任务详情 /kanban/{taskId}）</summary>
    public string? Link { get; set; }

    public bool IsDeleted { get; set; }
}
