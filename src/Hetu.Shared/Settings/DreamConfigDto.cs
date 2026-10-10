namespace Hetu.Shared.Settings;

/// <summary>
/// Dream（记忆巩固）配置：模拟人类睡眠巩固记忆的自动任务。
/// 自动模式由后台服务按周期执行；手动模式走 POST /api/memories/dream，两者共用同一套巩固逻辑。
/// </summary>
public class DreamConfigDto
{
    /// <summary>是否开启自动 Dream（后台按周期执行）</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>自动执行间隔（小时），默认 24 = 每天一次</summary>
    public int IntervalHours { get; set; } = 24;

    /// <summary>合并阈值：embedding 余弦相似度 ≥ 该值的同归属记忆合并为一条（0.85）</summary>
    public float MergeThreshold { get; set; } = 0.85f;

    /// <summary>衰减：超过该天数未被想起，重要性 ×0.8（默认 30 天）</summary>
    public int DecayDays { get; set; } = 30;

    /// <summary>遗忘：超过该天数未被想起且重要性低于阈值则清除（默认 180 天）</summary>
    public int ForgetDays { get; set; } = 180;

    /// <summary>遗忘的重要性下限（0.15）</summary>
    public float ForgetBelowImportance { get; set; } = 0.15f;

    /// <summary>最近一次执行时间（自动/手动都会刷新，只读展示）</summary>
    public DateTimeOffset? LastRunAt { get; set; }
}
