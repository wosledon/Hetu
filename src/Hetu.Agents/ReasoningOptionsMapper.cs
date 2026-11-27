using Microsoft.Extensions.AI;

namespace Hetu.Agents;

/// <summary>
/// 把 Hetu 的「推理强度 / 推理预算」折算为 MEAI 的 <see cref="ReasoningOptions"/>。
/// 官方 Anthropic 适配器只接受离散强度（1024/8192/16384/32768），预算按区间映射。
/// </summary>
internal static class ReasoningOptionsMapper
{
    public static ReasoningOptions? Create(string? effort, int? budgetTokens)
    {
        var parsed = Parse(effort);
        if (parsed is null && budgetTokens is > 0)
            parsed = FromBudget(budgetTokens.Value);
        return parsed is null ? null : new ReasoningOptions { Effort = parsed.Value };
    }

    private static ReasoningEffort? Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return value.Trim().ToLowerInvariant() switch
        {
            "none" or "off" => ReasoningEffort.None,
            "minimal" or "low" => ReasoningEffort.Low,
            "medium" => ReasoningEffort.Medium,
            "high" => ReasoningEffort.High,
            "xhigh" or "max" => ReasoningEffort.ExtraHigh,
            _ => ReasoningEffort.Medium,
        };
    }

    private static ReasoningEffort FromBudget(int budgetTokens) => budgetTokens switch
    {
        <= 1024 => ReasoningEffort.Low,
        <= 8192 => ReasoningEffort.Medium,
        <= 16384 => ReasoningEffort.High,
        _ => ReasoningEffort.ExtraHigh,
    };
}