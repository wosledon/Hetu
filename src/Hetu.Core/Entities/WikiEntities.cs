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
    /// <summary>Markdown 正文</summary>
    public string Content { get; set; } = string.Empty;
}
