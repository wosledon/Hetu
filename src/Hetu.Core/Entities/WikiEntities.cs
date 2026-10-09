namespace Hetu.Core.Entities;

/// <summary>
/// 项目 Wiki 文档：AI 读取受管项目目录资料后生成的结构化 Markdown 文档，挂在项目下可重复生成。
/// </summary>
public class WikiDocument : BaseEntity
{
    /// <summary>所属受管项目</summary>
    public Guid ProjectId { get; set; }
    public ManagedProject? Project { get; set; }
    public string Title { get; set; } = string.Empty;
    /// <summary>Markdown 正文</summary>
    public string Content { get; set; } = string.Empty;
}
