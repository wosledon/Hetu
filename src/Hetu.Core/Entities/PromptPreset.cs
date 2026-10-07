namespace Hetu.Core.Entities;

/// <summary>智能体类型：General（通用）| Professional（专业）</summary>
public static class AgentTypes
{
    public const string General = "General";
    public const string Professional = "Professional";
}

public class PromptPreset : BaseEntity
{
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Variables { get; set; }
    /// <summary>
    /// JSON: { variables: string[], tools: string[], toolApprovals: Record&lt;string, string&gt; }
    /// </summary>
    public string? ToolsConfig { get; set; }
    public bool IsBuiltIn { get; set; }
    public int SortOrder { get; set; }
    /// <summary>智能体类型：General（通用）| Professional（专业）</summary>
    public string AgentType { get; set; } = AgentTypes.General;
    /// <summary>专业智能体可管理的子智能体 ID 列表（JSON 数组，引用其他 PromptPreset）</summary>
    public string? SubAgentIds { get; set; }
    /// <summary>专业智能体绑定的模型 ID；为空时跟随请求/话题模型</summary>
    public Guid? ModelId { get; set; }
    /// <summary>专业智能体指定的模型推理强度：low | medium | high</summary>
    public string? ReasoningEffort { get; set; }
    /// <summary>专业智能体可使用的技能 ID 列表（JSON 数组，引用 Skill）</summary>
    public string? SkillIds { get; set; }
}
