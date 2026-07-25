namespace Hetu.Shared.Chat;

public class UsageOverviewDto
{
    public long TotalMessages { get; set; }
    public long TotalTokens { get; set; }
    public long TotalCachedTokens { get; set; }
    public double AvgLatencyMs { get; set; }
    public int ActiveDays { get; set; }
    public long TodayMessages { get; set; }
    public long TodayTokens { get; set; }
    /// <summary>原始输入 Token（压缩前估算）</summary>
    public long TotalInputTokens { get; set; }
    /// <summary>压缩后实际发送的 Prompt Token</summary>
    public long TotalCompressedTokens { get; set; }
    /// <summary>LLM 输出的 Completion Token</summary>
    public long TotalOutputTokens { get; set; }
}

public class UsageDayStat
{
    /// <summary>yyyy-MM-dd（本地时区）</summary>
    public string Date { get; set; } = string.Empty;
    public long Messages { get; set; }
    public long Tokens { get; set; }
}

public class UsageHourStat
{
    /// <summary>yyyy-MM-dd（本地时区）</summary>
    public string Date { get; set; } = string.Empty;
    /// <summary>0-23</summary>
    public int Hour { get; set; }
    public long Messages { get; set; }
    public long Tokens { get; set; }
}

public class UsageModelStat
{
    public string ModelName { get; set; } = string.Empty;
    public long Messages { get; set; }
    public long Tokens { get; set; }
    public long CachedTokens { get; set; }
}

public class UsageStatsDto
{
    public UsageOverviewDto Overview { get; set; } = new();
    /// <summary>近 7 天按天的趋势（含 0 填充）</summary>
    public List<UsageDayStat> DailyTrend { get; set; } = new();
    /// <summary>近 365 天按天聚合（GitHub 风格年热力图，仅含有数据的日期）</summary>
    public List<UsageDayStat> YearDaily { get; set; } = new();
    /// <summary>近 7 天按 日期×小时 聚合（周热力图，仅含有数据的格子）</summary>
    public List<UsageHourStat> WeekHourly { get; set; } = new();
    /// <summary>按模型聚合</summary>
    public List<UsageModelStat> ByModel { get; set; } = new();
}

public class UsageLogDto
{
    public Guid MessageId { get; set; }
    public Guid TopicId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string ModelName { get; set; } = string.Empty;
    public int? InputTokens { get; set; }
    public int? CompressedTokens { get; set; }
    public int? OutputTokens { get; set; }
    public int? TokensUsed { get; set; }
    public int? CachedTokens { get; set; }
    public int? LatencyMs { get; set; }
    public string ContentPreview { get; set; } = string.Empty;
}
