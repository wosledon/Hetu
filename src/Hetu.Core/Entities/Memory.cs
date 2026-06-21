namespace Hetu.Core.Entities;

/// <summary>
/// 长期记忆实体，存储从对话中提取的事实和用户偏好
/// </summary>
public class Memory : BaseEntity
{
    /// <summary>记忆内容（事实文本）</summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>来源类型: conversation / manual</summary>
    public string Source { get; set; } = "conversation";

    /// <summary>来源话题 ID（可选）</summary>
    public Guid? TopicId { get; set; }

    /// <summary>记忆类别（可选）</summary>
    public string? Category { get; set; }

    /// <summary>重要性权重 (0-1)，由 LLM 评估</summary>
    public float Importance { get; set; } = 0.5f;

    /// <summary>最后访问时间，用于回归衰减</summary>
    public DateTimeOffset LastAccessedAt { get; set; }

    /// <summary>被检索次数</summary>
    public int AccessCount { get; set; }

    /// <summary>是否软删除</summary>
    public bool IsDeleted { get; set; }
}
