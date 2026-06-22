namespace Hetu.Shared.Tasks;

/// <summary>
/// 定时任务种类
/// </summary>
public static class ScheduledTaskKinds
{
    public const string Skill = "Skill";
    public const string AiTask = "AiTask";
    public const string GraphRebuild = "GraphRebuild";
    public const string EmbeddingRegenerate = "EmbeddingRegenerate";

    public static readonly IReadOnlyList<string> All = [Skill, AiTask, GraphRebuild, EmbeddingRegenerate];
}

/// <summary>
/// 调度类型
/// </summary>
public static class ScheduleTypes
{
    public const string Interval = "Interval";
    public const string Cron = "Cron";
}

public class ScheduledTaskDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string TaskKind { get; set; } = string.Empty;
    public string? TargetId { get; set; }
    public string? TargetName { get; set; }
    public string? Parameters { get; set; }
    public string ScheduleType { get; set; } = ScheduleTypes.Interval;
    public int IntervalMinutes { get; set; }
    public string? CronExpression { get; set; }
    public bool IsEnabled { get; set; }
    public DateTimeOffset? NextRunAt { get; set; }
    public DateTimeOffset? LastRunAt { get; set; }
    public string? LastStatus { get; set; }
    public string? LastError { get; set; }
    public int MaxRetries { get; set; }
    public int RetryCount { get; set; }
    public Guid? TopicId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateScheduledTaskRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string TaskKind { get; set; } = ScheduledTaskKinds.Skill;
    public string? TargetId { get; set; }
    public string? TargetName { get; set; }
    public string? Parameters { get; set; }
    public string ScheduleType { get; set; } = ScheduleTypes.Interval;
    public int IntervalMinutes { get; set; } = 60;
    public string? CronExpression { get; set; }
    public bool IsEnabled { get; set; } = true;
    public int MaxRetries { get; set; } = 0;
    /// <summary>绑定会话 Topic ID：执行结果将作为 assistant 消息追加到该会话</summary>
    public Guid? TopicId { get; set; }
}

public class UpdateScheduledTaskRequest : CreateScheduledTaskRequest { }

public class ScheduledTaskExecutionDto
{
    public Guid Id { get; set; }
    public Guid ScheduledTaskId { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string Status { get; set; } = "Running";
    public string? ErrorMessage { get; set; }
    public string? Result { get; set; }
    public int RetryAttempt { get; set; }
    public bool IsManual { get; set; }
    public long? DurationMs { get; set; }
}

/// <summary>
/// 可选执行目标（如技能列表），用于前端下拉选择
/// </summary>
public class ScheduledTaskTargetOption
{/// <summary>目标标识：数据库技能为 Guid，本地技能为 "local:xxx"</summary>
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    /// <summary>来源：database | local</summary>
    public string Source { get; set; } = "database";
}

public class ScheduledTaskTargetOptionsDto
{
    public List<ScheduledTaskTargetOption> Skills { get; set; } = new();
    public List<ScheduledTaskTargetOption> LocalSkills { get; set; } = new();
}
