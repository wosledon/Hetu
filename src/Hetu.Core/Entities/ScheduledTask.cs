namespace Hetu.Core.Entities;

/// <summary>
/// 定时任务定义：按计划周期触发 Skill、图谱重建、Embedding 重建等
/// </summary>
public class ScheduledTask : BaseEntity
{
    /// <summary>任务名称</summary>
    public string Name { get; set; } = string.Empty;
    /// <summary>描述</summary>
    public string? Description { get; set; }

    /// <summary>
    /// 任务种类：Skill | GraphRebuild | EmbeddingRegenerate
    /// </summary>
    public string TaskKind { get; set; } = string.Empty;

    /// <summary>执行目标 ID（如技能 ID），图谱/Embedding 重建可为空</summary>
    public string? TargetId { get; set; }
    /// <summary>执行目标名称（用于展示）</summary>
    public string? TargetName { get; set; }
    /// <summary>执行参数（JSON，如 Skill 的 input）</summary>
    public string? Parameters { get; set; }

    /// <summary>调度类型：Interval | Cron</summary>
    public string ScheduleType { get; set; } = "Interval";
    /// <summary>Interval 模式下的间隔分钟数</summary>
    public int IntervalMinutes { get; set; }
    /// <summary>Cron 模式下的 Cron 表达式（5 段：分 时 日 月 周）</summary>
    public string? CronExpression { get; set; }

    /// <summary>是否启用</summary>
    public bool IsEnabled { get; set; } = true;
    /// <summary>下次运行时间（UTC）</summary>
    public DateTimeOffset? NextRunAt { get; set; }
    /// <summary>上次运行时间（UTC）</summary>
    public DateTimeOffset? LastRunAt { get; set; }
    /// <summary>上次运行状态：null | Success | Failed | Running</summary>
    public string? LastStatus { get; set; }
    /// <summary>上次错误信息</summary>
    public string? LastError { get; set; }

    /// <summary>最大重试次数</summary>
    public int MaxRetries { get; set; } = 0;
    /// <summary>当前重试次数</summary>
    public int RetryCount { get; set; } = 0;

    /// <summary>绑定会话 Topic ID：执行结果将作为 assistant 消息追加到该会话</summary>
    public Guid? TopicId { get; set; }

    public bool IsDeleted { get; set; }
}
