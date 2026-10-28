namespace Hetu.Shared.Settings;

/// <summary>
/// 记忆使用范围：三个对话面各自独立决定是否启用记忆（召回相关记忆 + 沉淀新记忆）。
/// 原先这是每个会话里的开关，现收敛到「设置 - 记忆」统一配置，会话中不再决定。
/// </summary>
public class MemoryUsageConfigDto
{
    /// <summary>主对话是否启用记忆</summary>
    public bool MainChat { get; set; }

    /// <summary>普通对话（话题）是否启用记忆</summary>
    public bool Chat { get; set; }

    /// <summary>Code 会话是否启用记忆</summary>
    public bool CodeSession { get; set; }
}
