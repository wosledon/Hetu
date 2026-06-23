namespace Hetu.Core.Entities;

/// <summary>
/// 智能体定义。可被工作流节点引用，封装系统提示词、模型、工具、技能与 MCP 服务器配置。
/// 与 PromptPreset 解耦：PromptPreset 保留为对话内的提示词预设，Agent 作为一等实体供工作流编排。
/// </summary>
public class Agent : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;

    /// <summary>系统提示词（人设/指令）</summary>
    public string SystemPrompt { get; set; } = string.Empty;

    /// <summary>绑定的 AI 模型 ID（为空时使用默认对话模型）</summary>
    public Guid? ModelId { get; set; }

    /// <summary>JSON: string[] — 启用的内置工具名列表</summary>
    public string? ToolNames { get; set; }

    /// <summary>JSON: Guid[] — 启用的 MCP 服务器 ID 列表</summary>
    public string? McpServerIds { get; set; }

    /// <summary>JSON: string[] — 关联的技能 ID 列表（预留，节点执行时可注入技能提示词）</summary>
    public string? SkillIds { get; set; }

    /// <summary>JSON: Record&lt;string,string&gt; — 工具审批策略覆盖（工具名 → bypass/auto/ask）</summary>
    public string? ToolApprovals { get; set; }

    /// <summary>单轮回复内最大工具调用次数（软上限，写入提示词）</summary>
    public int MaxToolCallsPerTurn { get; set; } = 5;

    /// <summary>Agent Loop 最大迭代次数（硬上限）</summary>
    public int MaxAgentIterations { get; set; } = 15;

    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; }
}
