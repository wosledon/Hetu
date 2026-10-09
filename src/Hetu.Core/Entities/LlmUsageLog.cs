namespace Hetu.Core.Entities;

/// <summary>
/// 统一的 LLM 用量记录。所有调用 LLM 的路径（对话、编码会话、看板任务、工作流、
/// Wiki 生成、笔记 AI、话题整理、技能、图谱抽取、查询改写、定时任务、代理转发）
/// 都通过 <c>ILlmUsageRecorder</c> 记一条，供用量统计统一聚合。
/// </summary>
public class LlmUsageLog : BaseEntity
{
    /// <summary>调用来源：chat / work / kanban / workflow / wiki / note-ai / organize / skill / graph / search / scheduled / proxy</summary>
    public string Source { get; set; } = "chat";

    /// <summary>来源内部引用（话题 / 会话 / 任务 / 工作流运行 / 笔记 ID 等）</summary>
    public Guid? RefId { get; set; }

    public Guid? ModelId { get; set; }

    public int? InputTokens { get; set; }

    /// <summary>压缩后实际发送的 Prompt Token（与 InputTokens 相同时留空）</summary>
    public int? CompressedTokens { get; set; }

    public int? OutputTokens { get; set; }

    public int? TokensUsed { get; set; }

    public int? CachedTokens { get; set; }

    public int? LatencyMs { get; set; }

    /// <summary>调用内容摘要（截断），用于用量明细列表展示</summary>
    public string? ContentPreview { get; set; }
}
