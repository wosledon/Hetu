namespace Hetu.Core.Entities;

/// <summary>
/// 项目 Wiki 页面：AI 读取受管项目目录资料后生成的结构化 Markdown 页面。
/// 一次生成的所有页面共享 <see cref="SetId"/>（总览页 SortOrder = 0），构成一套 DeepWiki 风格的多页文档。
/// </summary>
public class WikiDocument : BaseEntity
{
    /// <summary>所属受管项目</summary>
    public Guid ProjectId { get; set; }
    public ManagedProject? Project { get; set; }
    /// <summary>所属 Wiki 套件（一次生成的所有页面共享）</summary>
    public Guid SetId { get; set; }
    /// <summary>套件内排序：0 为总览页</summary>
    public int SortOrder { get; set; }
    public string Title { get; set; } = string.Empty;
    /// <summary>所属章节（父子级结构中的父级）；为空表示未分章</summary>
    public string? Chapter { get; set; }
    /// <summary>规划阶段确定的内容要点（单页重生成时复用）</summary>
    public string? Brief { get; set; }
    /// <summary>Markdown 正文</summary>
    public string Content { get; set; } = string.Empty;
}

/// <summary>
/// Wiki 生成任务：生成耗时较长（规划 + 多页 LLM 调用），入队后由后台处理器执行，前端轮询进度。
/// </summary>
public class WikiGenerationJob : BaseEntity
{
    public Guid ProjectId { get; set; }
    public ManagedProject? Project { get; set; }
    /// <summary>0=Queued, 1=Running, 2=Completed, 3=Failed</summary>
    public int Status { get; set; }
    /// <summary>当前阶段文案（采集资料 / 规划分页 / 生成页面 / 生成总览）</summary>
    public string Stage { get; set; } = string.Empty;
    /// <summary>进度百分比 0-100</summary>
    public int Progress { get; set; }
    public int TotalPages { get; set; }
    public int DonePages { get; set; }
    public string? ErrorMessage { get; set; }
    /// <summary>部分页面失败时的提示（整套仍算完成）</summary>
    public string? WarningMessage { get; set; }
    /// <summary>生成所用模型展示名（未指定时为默认模型）</summary>
    public string? ModelId { get; set; }
    /// <summary>完成后产生的 Wiki 套件 ID</summary>
    public Guid? SetId { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}
