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

    /// <summary>
    /// 记忆作用域，模拟记忆的归属层级：
    /// Global 全局（跨会话公共记忆）/ Session 会话（绑定 TopicId，仅该会话检索命中）/
    /// Project 项目（绑定 ProjectId，项目上下文检索命中）。检索时 = 当前作用域 ∪ Global。
    /// </summary>
    public string Scope { get; set; } = "Global";

    /// <summary>项目作用域记忆绑定的受管项目 ID（Scope=Project 时必填）</summary>
    public Guid? ProjectId { get; set; }

    /// <summary>记忆类别（可选）</summary>
    public string? Category { get; set; }

    /// <summary>重要性权重 (0-1)，由 LLM 评估；Dream 巩固时衰减、合并时取强</summary>
    public float Importance { get; set; } = 0.5f;

    /// <summary>最后访问时间，用于回归衰减（Dream 巩固依据其计算「记忆新鲜度」）</summary>
    public DateTimeOffset LastAccessedAt { get; set; }

    /// <summary>被检索次数（频率强化：越常被想起的记忆越牢固）</summary>
    public int AccessCount { get; set; }

    /// <summary>是否软删除</summary>
    public bool IsDeleted { get; set; }
}
