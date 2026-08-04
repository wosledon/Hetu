namespace Hetu.Core.Entities;

/// <summary>工作文件变更记录：会话内 work_write_file 写入前后内容，用于展示 diff</summary>
public class WorkFileChange : BaseEntity
{
    public Guid ProjectId { get; set; }
    public Guid? SessionId { get; set; }
    /// <summary>相对项目根的文件路径</summary>
    public string FilePath { get; set; } = string.Empty;
    /// <summary>写入前内容（新文件为 null）</summary>
    public string? OldContent { get; set; }
    /// <summary>写入后内容</summary>
    public string NewContent { get; set; } = string.Empty;
    /// <summary>write（覆盖）| create（新建）</summary>
    public string Action { get; set; } = "write";
}
