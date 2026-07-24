namespace Hetu.Shared.Chat;

public class UsageOverviewDto
{
    public long TotalMessages { get; set; }
    public long TotalTokens { get; set; }
    public double AvgLatencyMs { get; set; }
    public int ActiveDays { get; set; }
    public long TodayMessages { get; set; }
    public long TodayTokens { get; set; }
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
