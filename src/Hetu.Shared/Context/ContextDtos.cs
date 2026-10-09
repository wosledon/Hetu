namespace Hetu.Shared.Context;

/// <summary>上下文占用的一块（系统提示 / 历史消息 / 摘要 ...），token 为估算值（约 3 字符/token）</summary>
public class ContextUsagePartDto
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public long Tokens { get; set; }
    public long Chars { get; set; }
    /// <summary>是否为估算（系统提示部分由真实用量反推，其余按字符折算）</summary>
    public bool Estimated { get; set; } = true;
}

/// <summary>会话上下文占用：窗口大小、已用 token、分块明细</summary>
public class ContextUsageDto
{
    /// <summary>生效的上下文窗口（token）</summary>
    public int Window { get; set; }
    /// <summary>已用 token（优先取上一轮真实 prompt tokens，其次为估算）</summary>
    public long Used { get; set; }
    public List<ContextUsagePartDto> Parts { get; set; } = [];
    /// <summary>是否已存在上下文摘要</summary>
    public bool HasSummary { get; set; }
    /// <summary>摘要覆盖到的消息数</summary>
    public int SummarizedMessages { get; set; }
    /// <summary>占用率（0-1），前端画环形进度</summary>
    public double Ratio => Window > 0 ? Math.Min(1d, (double)Used / Window) : 0d;
}

/// <summary>手动压缩上下文（/compress）请求</summary>
public class CompactContextRequest
{
    /// <summary>会话级上下文上限（token），用于判断是否超限</summary>
    public int? ContextWindow { get; set; }
    /// <summary>摘要用模型（数据库模型 Id），留空用当前默认模型</summary>
    public Guid? ModelId { get; set; }
    /// <summary>保留最近多少条消息不压缩</summary>
    public int KeepRecent { get; set; } = 6;
}

/// <summary>压缩结果</summary>
public class CompactContextResultDto
{
    /// <summary>被摘要的消息条数</summary>
    public int MessageCount { get; set; }
    public int SummaryChars { get; set; }
    /// <summary>压缩前占用的 token（估算）</summary>
    public long BeforeTokens { get; set; }
    /// <summary>压缩后占用的 token（估算）</summary>
    public long AfterTokens { get; set; }
    public string? Summary { get; set; }
}
