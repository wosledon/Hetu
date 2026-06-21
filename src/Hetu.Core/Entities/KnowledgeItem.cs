namespace Hetu.Core.Entities;

/// <summary>
/// 知识库项目的类型
/// </summary>
public enum KnowledgeItemType
{
    /// <summary>笔记</summary>
    Note = 0,
    /// <summary>用户上传的文件</summary>
    File = 1,
    /// <summary>用户添加的网址</summary>
    Url = 2,
}

/// <summary>
/// 知识库项目，统一管理笔记、文件、网址三种类型的索引入口
/// </summary>
public class KnowledgeItem : BaseEntity
{
    /// <summary>项目类型</summary>
    public KnowledgeItemType Type { get; set; }

    /// <summary>显示标题</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>用于索引的文本内容（笔记来自 Note.Content，文件为提取文本，网址为抓取内容）</summary>
    public string Content { get; set; } = string.Empty;

    // ── 文件类特有字段 ──
    /// <summary>原始文件存储路径</summary>
    public string? FilePath { get; set; }
    /// <summary>原始文件名</summary>
    public string? FileName { get; set; }
    /// <summary>文件大小（字节）</summary>
    public long? FileSize { get; set; }
    /// <summary>MIME 类型</summary>
    public string? MimeType { get; set; }

    // ── 网址类特有字段 ──
    /// <summary>来源 URL</summary>
    public string? SourceUrl { get; set; }

    // ── 笔记类关联 ──
    /// <summary>关联的笔记 ID（仅笔记类型有值）</summary>
    public Guid? NoteId { get; set; }
    public Note? Note { get; set; }

    /// <summary>软删除标记</summary>
    public bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }

    /// <summary>该知识项的分块列表</summary>
    public List<NoteChunk> Chunks { get; set; } = [];
}
