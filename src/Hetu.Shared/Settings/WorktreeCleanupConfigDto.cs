namespace Hetu.Shared.Settings;

/// <summary>
/// Code 工作树自动清理配置：清理「已合并/已完成」且干净的工作树，
/// 以及不再被任何会话引用的孤立工作树（后者属于纯垃圾，始终清理）。
/// </summary>
public class WorktreeCleanupConfigDto
{
    /// <summary>是否开启自动清理（后台按周期执行）；手动「立即清理」不受此开关限制</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>自动检查间隔（小时），默认 6</summary>
    public int IntervalHours { get; set; } = 6;

    /// <summary>工作树空闲多久（小时）后才允许自动清理，默认 24——避免清掉正在用的工作树</summary>
    public int IdleHours { get; set; } = 24;

    /// <summary>清理已合并工作树时，是否连同它的本地分支一起删除（默认保留分支）</summary>
    public bool DeleteMergedBranch { get; set; }

    /// <summary>最近一次执行时间（自动/手动都会刷新，只读展示）</summary>
    public DateTimeOffset? LastRunAt { get; set; }

    /// <summary>最近一次清理掉的工作树数量（只读展示）</summary>
    public int LastRemoved { get; set; }
}

/// <summary>工作树清理结果（手动/自动共用）</summary>
public class WorktreeCleanupResultDto
{
    /// <summary>本次清理掉的工作树数量</summary>
    public int Removed { get; set; }

    /// <summary>检查过的工作树数量</summary>
    public int Checked { get; set; }

    /// <summary>仍在使用或未完成而保留的数量</summary>
    public int Kept { get; set; }
}
