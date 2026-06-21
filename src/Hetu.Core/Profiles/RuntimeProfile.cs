namespace Hetu.Core.Profiles;

/// <summary>
/// 运行身份（Runtime Profile）。
/// 定义一个 Agent 实例的核心身份、行为约束、工具白名单等。
/// 不同 profile 之间互不串扰（如知识助手 vs 桌面 Agent vs 协作助手）。
/// </summary>
public class RuntimeProfile
{
    /// <summary>内部唯一标识，如 "hetu.knowledge"</summary>
    public string Id { get; init; } = string.Empty;

    /// <summary>对外展示名</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>作用范围（用于区分人格场景）</summary>
    public ProfileScope Scope { get; init; } = ProfileScope.Personal;

    /// <summary>身份描述：你是谁</summary>
    public string IdentityPrompt { get; init; } = string.Empty;

    /// <summary>核心原则：你怎么做</summary>
    public string PrinciplePrompt { get; init; } = string.Empty;

    /// <summary>输出格式约定</summary>
    public string FormatPrompt { get; init; } = string.Empty;

    /// <summary>安全底线</summary>
    public string SafetyPrompt { get; init; } = string.Empty;

    /// <summary>允许的工具白名单（空集合表示无限制）</summary>
    public IReadOnlySet<string> AllowedTools { get; init; } = new HashSet<string>();

    /// <summary>明确禁用的工具（优先级高于 AllowedTools）</summary>
    public IReadOnlySet<string> DeniedTools { get; init; } = new HashSet<string>();

    /// <summary>单轮回复内最大工具调用次数（软上限，写入 prompt）</summary>
    public int MaxToolCallsPerTurn { get; init; } = 5;

    /// <summary>Agent Loop 最大迭代次数（硬上限）</summary>
    public int MaxAgentIterations { get; init; } = 15;

    /// <summary>判断某个工具是否允许在该 profile 下使用</summary>
    public bool IsToolAllowed(string toolName)
    {
        if (DeniedTools.Contains(toolName)) return false;
        if (AllowedTools.Count == 0) return true; // 空白名单视为不限制
        return AllowedTools.Contains(toolName);
    }
}

/// <summary>Profile 作用范围</summary>
public enum ProfileScope
{
    /// <summary>个人本地场景（默认知识管理）</summary>
    Personal,

    /// <summary>多人协作场景</summary>
    Workspace,

    /// <summary>桌面操作场景（拥有系统级工具）</summary>
    Desktop,
}
