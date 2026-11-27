namespace Hetu.Shared.Settings;

/// <summary>Agent 会话记忆与会话持久化配置。</summary>
public class AgentMemorySettingsDto
{
    /// <summary>是否启用 ChatHistoryMemoryProvider（会话历史向量召回）。</summary>
    public bool EnableHistoryMemory { get; set; }

    /// <summary>是否让 MAF 在每次内部模型调用前后持久化历史。</summary>
    public bool UsePerServiceCallHistoryPersistence { get; set; }

    /// <summary>向量历史与会话快照的保留天数。</summary>
    public int RetentionDays { get; set; } = 30;
}