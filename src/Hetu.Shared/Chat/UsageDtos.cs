namespace Hetu.Shared.Chat;

public class UsageOverviewDto
{
    /// <summary>模型请求数（一行日志 = 一次请求，一轮 Agent 可能有多次）</summary>
    public long TotalMessages { get; set; }
    public long TotalTokens { get; set; }
    public long TotalCachedTokens { get; set; }
    /// <summary>写入缓存的 Token（Anthropic cache_creation，计费高于常规输入）</summary>
    public long TotalCacheCreationTokens { get; set; }
    /// <summary>Provider 实报的 Prompt Token 合计，缓存命中率的分母</summary>
    public long TotalPromptTokens { get; set; }
    /// <summary>缓存命中率 = 缓存读取 / 实报 Prompt；无实报数据时为 null</summary>
    public double? CacheHitRate { get; set; }
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
    /// <summary>实报 Prompt Token 合计，用于按模型算缓存命中率</summary>
    public long PromptTokens { get; set; }
}

/// <summary>按天×模型聚合的用量（趋势图按模型拆分）</summary>
public class UsageModelDayStat
{
    /// <summary>yyyy-MM-dd（本地时区）</summary>
    public string Date { get; set; } = string.Empty;
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
    /// <summary>近 90 天按 日期×模型 聚合（趋势图按模型拆分）</summary>
    public List<UsageModelDayStat> DailyByModel { get; set; } = new();
    /// <summary>按调用来源聚合（对话 / 编码会话 / 任务看板 / Wiki / ...）</summary>
    public List<UsageSourceStat> BySource { get; set; } = new();
    /// <summary>按来源×模型聚合（调用来源条形图按模型堆叠）</summary>
    public List<UsageSourceModelStat> BySourceByModel { get; set; } = new();
}

/// <summary>按调用来源聚合的用量</summary>
public class UsageSourceStat
{
    /// <summary>chat / work / kanban / workflow / wiki / note-ai / organize / skill / graph / search / scheduled / proxy</summary>
    public string Source { get; set; } = string.Empty;
    /// <summary>来源中文名</summary>
    public string SourceName { get; set; } = string.Empty;
    public long Messages { get; set; }
    public long Tokens { get; set; }
}

/// <summary>按来源×模型聚合的用量（调用来源条形图按模型堆叠）</summary>
public class UsageSourceModelStat
{
    /// <summary>chat / work / kanban / workflow / wiki / note-ai / organize / skill / graph / search / scheduled / proxy</summary>
    public string Source { get; set; } = string.Empty;
    /// <summary>来源中文名</summary>
    public string SourceName { get; set; } = string.Empty;
    public string ModelName { get; set; } = string.Empty;
    public long Messages { get; set; }
    public long Tokens { get; set; }
}

public class UsageLogDto
{
    public Guid MessageId { get; set; }
    public Guid TopicId { get; set; }
    /// <summary>同一用户轮次的分组键：一轮 Agent 的多次请求共享它</summary>
    public Guid? TurnId { get; set; }
    /// <summary>轮次内的请求序号（1 起）；非 Agent 路径为空</summary>
    public int? Iteration { get; set; }
    /// <summary>agent / subagent / compression / compaction / summarize / classify / memory</summary>
    public string RequestKind { get; set; } = "agent";
    /// <summary>请求类型展示名</summary>
    public string RequestKindName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public string ModelName { get; set; } = string.Empty;
    public int? InputTokens { get; set; }
    public int? CompressedTokens { get; set; }
    /// <summary>Provider 实报的完整 Prompt Token（含缓存），缓存命中率的分母</summary>
    public int? PromptTokens { get; set; }
    public int? OutputTokens { get; set; }
    public int? TokensUsed { get; set; }
    public int? CachedTokens { get; set; }
    public int? CacheCreationTokens { get; set; }
    public int? LatencyMs { get; set; }
    /// <summary>结束原因：stop / tool_calls / length / max_tokens …</summary>
    public string? FinishReason { get; set; }
    /// <summary>本次请求模型发起的工具调用数</summary>
    public int? ToolCallCount { get; set; }
    public string ContentPreview { get; set; } = string.Empty;
    /// <summary>chat / work / kanban / workflow / wiki / note-ai / organize / skill / graph / search / scheduled / proxy / compression</summary>
    public string Source { get; set; } = "chat";
    /// <summary>来源中文名</summary>
    public string SourceName { get; set; } = "对话";
}
