using System.Text.Json;
using System.Text.RegularExpressions;

namespace Hetu.Core.Services.Workflows;

/// <summary>
/// 模板解析器。将 <c>{{nodeId.varName}}</c> 或 <c>{{nodeId.path[0].field}}</c> 替换为上下文中的实际值。
/// 支持简单 JSONPath（点号 + 数组下标）。
/// </summary>
public static class TemplateResolver
{
    private static readonly Regex TemplatePattern = new(@"\{\{\s*([\w\-\.]+)(\[[\d]+\])*(\.[\w\-]+)*\s*\}\}", RegexOptions.Compiled);

    /// <summary>解析模板字符串，替换所有 {{...}} 占位符</summary>
    public static string Resolve(string? template, ExecutionContext ctx)
    {
        if (string.IsNullOrWhiteSpace(template)) return template ?? string.Empty;

        return TemplatePattern.Replace(template, match =>
        {
            var rawKey = match.Value.Trim('{', '}', ' ');
            // 尝试直接匹配 nodeId.varName
            var direct = ctx.GetVariableText(rawKey);
            if (direct != null) return direct;

            // 尝试 JSONPath 拆解：nodeId.path[0].field
            var dotIdx = rawKey.IndexOf('.');
            if (dotIdx <= 0) return match.Value;
            var baseKey = rawKey[..dotIdx];
            var path = rawKey[(dotIdx + 1)..];

            if (ctx.TryGetVariable(baseKey, out var el))
            {
                var resolved = ResolveJsonPath(el, path);
                if (resolved != null) return resolved;
            }
            return match.Value;
        });
    }

    /// <summary>解析 JSONPath（点号 + 数组下标），返回字符串值</summary>
    private static string? ResolveJsonPath(JsonElement element, string path)
    {
        var current = element;
        var parts = ParsePath(path);
        foreach (var part in parts)
        {
            if (part.IsIndex)
            {
                if (current.ValueKind != JsonValueKind.Array || part.Index >= current.GetArrayLength())
                    return null;
                current = current[part.Index];
            }
            else
            {
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(part.Name, out var child))
                    return null;
                current = child;
            }
        }
        return current.ValueKind switch
        {
            JsonValueKind.String => current.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => current.GetRawText()
        };
    }

    private static List<PathPart> ParsePath(string path)
    {
        var parts = new List<PathPart>();
        var segments = path.Split('.');
        foreach (var seg in segments)
        {
            // 处理 array[0] 形式
            var bracketIdx = seg.IndexOf('[');
            if (bracketIdx >= 0)
            {
                var name = seg[..bracketIdx];
                if (!string.IsNullOrEmpty(name))
                    parts.Add(new PathPart(name));
                var bracketPart = seg[bracketIdx..];
                var matches = Regex.Matches(bracketPart, @"\[(\d+)\]");
                foreach (Match m in matches)
                    parts.Add(new PathPart(int.Parse(m.Groups[1].Value)));
            }
            else
            {
                parts.Add(new PathPart(seg));
            }
        }
        return parts;
    }

    private record PathPart
    {
        public string Name { get; init; } = "";
        public int Index { get; init; }
        public bool IsIndex { get; init; }

        public PathPart(string name) { Name = name; IsIndex = false; }
        public PathPart(int index) { Index = index; IsIndex = true; }
    }

    /// <summary>求值简单条件表达式。支持：exists / == / != / contains / startsWith / endsWith</summary>
    public static bool EvaluateCondition(string? expression, ExecutionContext ctx)
    {
        if (string.IsNullOrWhiteSpace(expression)) return true;
        var expr = Resolve(expression, ctx).Trim();

        // exists 操作符（在 resolve 后无法判断，需特殊处理）
        if (expression!.TrimStart().StartsWith("exists ", StringComparison.OrdinalIgnoreCase))
        {
            var key = expression.Trim()[7..].Trim().Trim('{', '}', ' ');
            return ctx.GetVariableText(key) != null;
        }
        if (expression!.TrimStart().StartsWith("not exists ", StringComparison.OrdinalIgnoreCase))
        {
            var key = expression.Trim()[11..].Trim().Trim('{', '}', ' ');
            return ctx.GetVariableText(key) == null;
        }

        if (expr.Contains("==")) return EvaluateBinary(expr, "==", (a, b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase));
        if (expr.Contains("!=")) return EvaluateBinary(expr, "!=", (a, b) => !string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase));
        if (expr.Contains("contains:", StringComparison.OrdinalIgnoreCase))
            return EvaluateContains(expr, "contains:");
        if (expr.Contains("contains ", StringComparison.OrdinalIgnoreCase))
            return EvaluateContains(expr, "contains ");

        // 无操作符：非空即为真
        return !string.IsNullOrWhiteSpace(expr);
    }

    private static bool EvaluateBinary(string expr, string op, Func<string, string, bool> compare)
    {
        var parts = expr.Split(op, 2);
        if (parts.Length != 2) return false;
        return compare(parts[0], parts[1]);
    }

    private static bool EvaluateContains(string expr, string keyword)
    {
        var idx = expr.IndexOf(keyword, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return false;
        var left = expr[..idx].Trim();
        var right = expr[(idx + keyword.Length)..].Trim();
        return left.Contains(right, StringComparison.OrdinalIgnoreCase);
    }
}
