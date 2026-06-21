namespace Hetu.Core.Entities;

/// <summary>
/// 后台任务执行记录（Embedding、图谱提取等系统任务）
/// </summary>
public class TaskItem : BaseEntity
{
    /// <summary>任务类型：GenerateEmbedding, GraphExtract</summary>
    public string TaskType { get; set; } = string.Empty;
    /// <summary>关联的实体 ID（如笔记 ID）</summary>
    public Guid EntityId { get; set; }
    /// <summary>关联实体标题（方便展示）</summary>
    public string? EntityTitle { get; set; }
    /// <summary>0=Queued, 1=Running, 2=Completed, 3=Failed</summary>
    public int Status { get; set; }
    /// <summary>错误信息</summary>
    public string? ErrorMessage { get; set; }
    /// <summary>附加元数据</summary>
    public string? Metadata { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public bool IsDeleted { get; set; }
}
