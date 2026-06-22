namespace Hetu.Core.Entities;

/// <summary>
/// 定时任务执行历史记录
/// </summary>
public class ScheduledTaskExecution : BaseEntity
{
    public Guid ScheduledTaskId { get; set; }
    /// <summary>开始时间（UTC）</summary>
    public DateTimeOffset StartedAt { get; set; }
    /// <summary>完成时间（UTC）</summary>
    public DateTimeOffset? CompletedAt { get; set; }
    /// <summary>状态：Running | Success | Failed</summary>
    public string Status { get; set; } = "Running";
    /// <summary>错误信息</summary>
    public string? ErrorMessage { get; set; }
    /// <summary>结果摘要</summary>
    public string? Result { get; set; }
    /// <summary>重试次序（0 表示首次执行）</summary>
    public int RetryAttempt { get; set; }
    /// <summary>是否由手动触发</summary>
    public bool IsManual { get; set; }
}
