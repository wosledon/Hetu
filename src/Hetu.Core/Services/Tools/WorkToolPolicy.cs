using Hetu.Core.Entities;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>Work 会话权限模式</summary>
public enum WorkPermissionMode
{
    /// <summary>只读：拒绝一切写/执行类工具</summary>
    ReadOnly,
    /// <summary>询问：写/执行类工具执行前等待用户确认（默认）</summary>
    Ask,
    /// <summary>自动：写/执行类工具直接执行，读取静默折叠</summary>
    Auto,
    /// <summary>放行：全部直接执行</summary>
    Bypass
}

/// <summary>单个工具调用的审批决策</summary>
/// <param name="Allowed">是否允许执行</param>
/// <param name="Mode">执行时的审批模式</param>
/// <param name="DenyMessage">拒绝时返回给模型的说明</param>
public readonly record struct WorkToolDecision(bool Allowed, ToolApprovalMode Mode, string? DenyMessage = null);

/// <summary>
/// Work 权限策略：把会话权限模式 + 项目审批规则 + 工具风险等级，
/// 折算为逐次工具调用的审批决策。
/// </summary>
public static class WorkToolPolicy
{
    public const string DefaultMode = "ask";

    private static readonly string[] ModeValues = ["readonly", "ask", "auto", "bypass"];

    /// <summary>解析权限模式字符串，非法值回退为 <see cref="WorkPermissionMode.Ask"/></summary>
    public static WorkPermissionMode Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "readonly" or "read-only" or "read_only" => WorkPermissionMode.ReadOnly,
        "auto" => WorkPermissionMode.Auto,
        "bypass" => WorkPermissionMode.Bypass,
        _ => WorkPermissionMode.Ask
    };

    /// <summary>序列化为持久化字符串</summary>
    public static string ToValue(WorkPermissionMode mode) => mode switch
    {
        WorkPermissionMode.ReadOnly => "readonly",
        WorkPermissionMode.Auto => "auto",
        WorkPermissionMode.Bypass => "bypass",
        _ => "ask"
    };

    /// <summary>是否可被前端识别的合法值</summary>
    public static bool IsValidValue(string? value)
        => !string.IsNullOrWhiteSpace(value) && ModeValues.Contains(value.Trim().ToLowerInvariant());

    /// <summary>
    /// 计算一次工具调用的决策。规则优先于模式：显式 deny 会覆盖模式放行，显式 allow 会跳过询问。
    /// </summary>
    public static WorkToolDecision Decide(
        IToolExecutor? executor,
        string toolName,
        string? targetPath,
        WorkPermissionMode mode,
        IReadOnlyList<WorkApprovalRule>? rules)
    {
        var risk = executor?.Risk ?? ToolRisk.Write;

        if (mode == WorkPermissionMode.ReadOnly && risk != ToolRisk.Read)
        {
            return new WorkToolDecision(false, ToolApprovalMode.Bypass,
                $"当前会话处于只读模式，已拒绝执行 {toolName}。如需修改文件请在会话工具栏切换权限模式。");
        }

        var rule = MatchRule(rules, toolName, targetPath);
        if (rule?.Decision == "deny")
        {
            return new WorkToolDecision(false, ToolApprovalMode.Bypass,
                $"项目审批规则禁止执行 {toolName}（规则 {rule.ToolName}{(string.IsNullOrEmpty(rule.PathPattern) ? "" : " / " + rule.PathPattern)}）。");
        }
        if (rule?.Decision == "allow")
        {
            return new WorkToolDecision(true, risk == ToolRisk.Read ? ToolApprovalMode.Bypass : ToolApprovalMode.Auto);
        }

        return mode switch
        {
            WorkPermissionMode.ReadOnly => new WorkToolDecision(true, ToolApprovalMode.Auto),
            WorkPermissionMode.Ask => new WorkToolDecision(true, DefaultApprovalForRisk(risk, ask: true)),
            WorkPermissionMode.Auto => new WorkToolDecision(true, DefaultApprovalForRisk(risk, ask: false)),
            _ => new WorkToolDecision(true, ToolApprovalMode.Bypass)
        };
    }

    private static ToolApprovalMode DefaultApprovalForRisk(ToolRisk risk, bool ask)
        => risk == ToolRisk.Read
            ? ToolApprovalMode.Auto
            : ask ? ToolApprovalMode.Ask : ToolApprovalMode.Auto;

    /// <summary>
    /// 匹配项目审批规则：精确工具名优先于通配符，带路径模式的规则优先于不带路径的规则。
    /// </summary>
    public static WorkApprovalRule? MatchRule(IReadOnlyList<WorkApprovalRule>? rules, string toolName, string? targetPath)
    {
        if (rules == null || rules.Count == 0) return null;

        WorkApprovalRule? best = null;
        var bestScore = -1;

        foreach (var rule in rules)
        {
            if (!rule.IsEnabled) continue;
            var nameMatch = rule.ToolName == "*" ||
                            string.Equals(rule.ToolName, toolName, StringComparison.OrdinalIgnoreCase);
            if (!nameMatch) continue;

            var score = rule.ToolName == "*" ? 0 : 2;
            if (!string.IsNullOrWhiteSpace(rule.PathPattern))
            {
                if (string.IsNullOrWhiteSpace(targetPath)) continue;
                if (!GlobMatch(rule.PathPattern, targetPath)) continue;
                score += 1;
            }

            if (score > bestScore)
            {
                bestScore = score;
                best = rule;
            }
        }

        return best;
    }

    /// <summary>
    /// 从工具调用参数中提取用于规则匹配的路径（相对项目根）。
    /// </summary>
    public static string? ExtractTargetPath(string toolName, string argumentsJson)
    {
        var key = toolName switch
        {
            "work_write_file" or "work_read_file" or "work_delete_file" or "work_apply_patch" => "path",
            "work_move_file" => "to",
            _ => null
        };
        if (key == null) return null;

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(argumentsJson);
            return doc.RootElement.TryGetProperty(key, out var el) && el.ValueKind == System.Text.Json.JsonValueKind.String
                ? el.GetString()
                : null;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// 简单的通配符匹配，支持 *（不跨 /）、**（跨目录）与 ?，'/' 与 '\' 等价。
    /// </summary>
    public static bool GlobMatch(string pattern, string path)
        => GlobToRegex(pattern).IsMatch(path.Replace('\\', '/').TrimStart('/'));

    /// <summary>把 glob 编译为正则（**/ 可匹配零级目录）</summary>
    public static System.Text.RegularExpressions.Regex GlobToRegex(string pattern)
    {
        var normalized = pattern.Replace('\\', '/').TrimStart('/');
        var body = System.Text.RegularExpressions.Regex.Escape(normalized)
            .Replace(@"\*\*/", "(?:.*/)?")
            .Replace(@"\*\*", ".*")
            .Replace(@"\*", "[^/]*")
            .Replace(@"\?", "[^/]");
        return new System.Text.RegularExpressions.Regex(
            "^" + body + "$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    }
}
