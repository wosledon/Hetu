using System.Text.Json;
using System.Text.RegularExpressions;

namespace Hetu.Core.Utilities;

/// <summary>
/// 从 LLM 文本回复中提取 JSON。
/// 模型经常把 JSON 包在 markdown 代码块里，或前后附带解释文字，因此需要先剥离再反序列化。
/// </summary>
public static class LlmJsonExtractor
{
    private static readonly Regex FencedJson = new(
        @"```(?:json)?\s*\n(?<json>[\s\S]*?)\n?```",
        RegexOptions.IgnoreCase);

    /// <summary>把 LLM 回复反序列化为 <typeparamref name="T"/>；无法解析时返回 <c>null</c>。</summary>
    public static T? Deserialize<T>(string? response) where T : class
    {
        if (string.IsNullOrWhiteSpace(response)) return null;

        try
        {
            return JsonSerializer.Deserialize<T>(Extract(response), JsonDefaults.CaseInsensitive);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>剥离 markdown 代码围栏，再截取最外层的 JSON 数组或对象。</summary>
    public static string Extract(string text)
    {
        var trimmed = text.Trim();

        var fenced = FencedJson.Match(trimmed);
        return fenced.Success ? fenced.Groups["json"].Value.Trim() : ExtractBracketed(trimmed);
    }

    /// <summary>截取最外层的 JSON 片段，去掉解释性前后缀；没有成对括号时原样返回。</summary>
    private static string ExtractBracketed(string text)
    {
        var arrayStart = text.IndexOf('[');
        var objectStart = text.IndexOf('{');
        if (arrayStart < 0 && objectStart < 0) return text;

        var isArray = objectStart < 0 || (arrayStart >= 0 && arrayStart < objectStart);
        var start = isArray ? arrayStart : objectStart;
        var end = isArray ? text.LastIndexOf(']') : text.LastIndexOf('}');

        return end > start ? text[start..(end + 1)] : text;
    }
}
