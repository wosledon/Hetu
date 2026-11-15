namespace Hetu.Core.Entities;

/// <summary>
/// 统一的 LLM 用量记录，一行 = 一次模型请求。所有调用 LLM 的路径（对话、编码会话、看板任务、工作流、
/// Wiki 生成、笔记 AI、话题整理、技能、图谱抽取、查询改写、定时任务、代理转发、上下文压缩）
/// 都通过 <c>ILlmUsageRecorder</c> 记一条，供用量统计统一聚合。
/// 同一用户轮次内的多次请求（Agent 迭代）用 <see cref="TurnId"/> 归组。
/// </summary>
public class LlmUsageLog : BaseEntity
{
    /// <summary>调用来源：chat / work / kanban / workflow / wiki / note-ai / organize / skill / graph / search / scheduled / proxy</summary>
    public string Source { get; set; } = "chat";

    /// <summary>来源内部引用（话题 / 会话 / 任务 / 工作流运行 / 笔记 ID 等）</summary>
    public Guid? RefId { get; set; }

    /// <summary>一次用户轮次的分组键：Agent 一轮内的多次模型请求共享同一个 TurnId</summary>
    public Guid? TurnId { get; set; }

    /// <summary>轮次内的请求序号（1 起）；非 Agent 路径为空</summary>
    public int? Iteration { get; set; }

    /// <summary>请求类型：agent / subagent / compression / compaction / summarize / classify / memory</summary>
    public string RequestKind { get; set; } = "agent";

    public Guid? ModelId { get; set; }

    /// <summary>压缩前的输入规模估算（字符折算），仅用于展示压缩率</summary>
    public int? InputTokens { get; set; }

    /// <summary>压缩后实际发送的 Prompt Token 估算（与 InputTokens 相同时留空）</summary>
    public int? CompressedTokens { get; set; }

    /// <summary>Provider 实报的完整 Prompt Token（含缓存读取与写入），缓存命中率的分母</summary>
    public int? PromptTokens { get; set; }

    public int? OutputTokens { get; set; }

    public int? TokensUsed { get; set; }

    public int? CachedTokens { get; set; }

    /// <summary>本次写入缓存的 Prompt Token（Anthropic cache_creation_input_tokens）</summary>
    public int? CacheCreationTokens { get; set; }

    public int? LatencyMs { get; set; }

    /// <summary>本次请求的结束原因（stop / tool_calls / length / max_tokens …）</summary>
    public string? FinishReason { get; set; }

    /// <summary>本次请求模型发起的工具调用数</summary>
    public int? ToolCallCount { get; set; }

    /// <summary>调用内容摘要（截断），用于用量明细列表展示</summary>
    public string? ContentPreview { get; set; }
}
