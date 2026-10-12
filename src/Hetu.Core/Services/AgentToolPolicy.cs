using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;

namespace Hetu.Core.Services;

/// <summary>
/// Agent 权限上下文：会话权限模式 + 项目审批规则。
/// 对话、编码会话、看板任务、工作流节点共用同一套策略输入。
/// </summary>
public sealed class AgentPolicyContext
{
    public WorkPermissionMode Mode { get; init; } = WorkPermissionMode.Ask;
    /// <summary>
    /// 实时解析当前生效的权限模式：每次工具决策时调用一次，
    /// 让会话进行中切换的档位（审批模式 / 交互模式）立即生效，不用等下一轮消息；
    /// 为空时用 <see cref="Mode"/>（回合开始时的快照）。
    /// </summary>
    public Func<Task<WorkPermissionMode>>? ResolveMode { get; init; }
    public IReadOnlyList<WorkApprovalRule>? Rules { get; init; }
}

/// <summary>
/// 统一的工具审批策略。把「会话权限模式 + 项目审批规则 + 工具风险等级 + 工具自身声明」
/// 折算为逐次工具调用的决策，供 <see cref="AgentLoopService"/> 的 <c>DecideToolCall</c> 使用。
/// <para>
/// 三个消费方的差异只体现在入参上：
/// 编码会话传入真实权限模式与项目规则；对话页传入 Auto 并沿用工具自身声明的默认审批；
/// 看板任务 / 工作流节点传入 Bypass 全放行。
/// </para>
/// </summary>
public static class AgentToolPolicy
{
    /// <summary>
    /// 生成统一的逐次决策回调。
    /// </summary>
    /// <param name="respectExecutorDefault">
    /// 模式未强制要求时，是否沿用工具自身声明的 <see cref="IToolExecutor.DefaultApproval"/>
    /// （对话页行为：只读工具静默、写工具自动、命令类工具需确认）。
    /// </param>
    public static Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>> CreateDecider(
        ToolRegistry registry,
        AgentPolicyContext context,
        bool respectExecutorDefault = false)
    {
        return async (toolCall, _) =>
        {
            var executor = registry.GetExecutor(toolCall.Name);
            var targetPath = WorkToolPolicy.ExtractTargetPath(toolCall.Name, toolCall.Arguments);
            var mode = context.ResolveMode != null ? await context.ResolveMode() : context.Mode;
            var decision = WorkToolPolicy.Decide(executor, toolCall.Name, targetPath, mode, context.Rules);

            if (respectExecutorDefault && decision is { Allowed: true } allowed
                && allowed.Mode == ToolApprovalMode.Auto && executor != null)
            {
                return allowed with { Mode = executor.DefaultApproval };
            }

            return decision;
        };
    }

    /// <summary>
    /// 合并逐工具审批配置（含 * 通配），非法值忽略。
    /// </summary>
    public static Dictionary<string, ToolApprovalMode> MergeOverrides(
        IEnumerable<KeyValuePair<string, string>>? raw,
        Dictionary<string, ToolApprovalMode>? into = null)
    {
        var result = into ?? new Dictionary<string, ToolApprovalMode>(StringComparer.OrdinalIgnoreCase);
        if (raw == null) return result;

        foreach (var kv in raw)
        {
            if (Enum.TryParse<ToolApprovalMode>(kv.Value, true, out var mode))
                result[kv.Key] = mode;
        }
        return result;
    }
}
