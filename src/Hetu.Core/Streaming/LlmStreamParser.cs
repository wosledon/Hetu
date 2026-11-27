using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Streaming;

/// <summary>LLM 流式帧解析后的事件类型。</summary>
public enum LlmStreamEventType
{
    /// <summary>正文增量</summary>
    Content,
    /// <summary>思考增量</summary>
    Thinking,
    /// <summary>本轮工具调用请求（流末一次性给出）</summary>
    ToolCalls,
}

/// <summary>单个解析结果。ToolCalls 事件只在文本工具调用闭合时出现。</summary>
public sealed class LlmStreamChunk
{
    public required LlmStreamEventType Type { get; init; }
    public string Text { get; init; } = string.Empty;
    public List<LlmToolCall>? ToolCalls { get; init; }
}

/// <summary>
/// 文本 delta 的标签解析器：把 <c>&lt;thinking&gt;...&lt;/thinking&gt;</c> 切分成思考/正文，
/// 把 <c>&lt;tool_call&gt;...&lt;/tool_call&gt;</c> 解析成结构化工具调用。
/// 原生工具调用（FunctionCallContent）不经过这里。
/// </summary>
public sealed class LlmStreamParser
{
    private const string OpenTag = "<thinking>";
    private const string CloseTag = "</thinking>";
    private const string ToolCallOpenTag = "<tool_call>";
    private const string ToolCallCloseTag = "</tool_call>";

    private bool _inThinking;
    private bool _inToolCall;
    private string _pendingFragment = "";
    private readonly StringBuilder _toolCallJson = new();

    /// <summary>解析一个 delta，返回 0..n 个归一化事件。</summary>
    public IReadOnlyList<LlmStreamChunk> Parse(string delta)
    {
        if (string.IsNullOrEmpty(delta)) return Array.Empty<LlmStreamChunk>();
        return ParseTagged(delta);
    }

    /// <summary>流结束时调用，释放仍挂起的半截标签片段。</summary>
    public IReadOnlyList<LlmStreamChunk> Flush()
    {
        if (_inToolCall)
        {
            var incomplete = $"{ToolCallOpenTag}{_toolCallJson}{_pendingFragment}";
            _inToolCall = false;
            _toolCallJson.Clear();
            _pendingFragment = "";
            return new[] { MakeText(LlmStreamEventType.Content, incomplete) };
        }
        if (_pendingFragment.Length == 0) return Array.Empty<LlmStreamChunk>();

        var fragment = _pendingFragment;
        _pendingFragment = "";
        return new[] { MakeText(_inThinking ? LlmStreamEventType.Thinking : LlmStreamEventType.Content, fragment) };
    }

    /// <summary>纯文本 delta 的 thinking / tool_call 标签切分。</summary>
    private IReadOnlyList<LlmStreamChunk> ParseTagged(string delta)
    {
        var result = new List<LlmStreamChunk>();
        var raw = _pendingFragment + delta;
        _pendingFragment = "";

        while (raw.Length > 0)
        {
            if (_inToolCall)
            {
                var closeIdx = raw.IndexOf(ToolCallCloseTag, StringComparison.OrdinalIgnoreCase);
                if (closeIdx < 0)
                {
                    var held = PartialTagSuffixLength(raw, ToolCallCloseTag);
                    _toolCallJson.Append(raw[..(raw.Length - held)]);
                    _pendingFragment = raw[(raw.Length - held)..];
                    return result;
                }

                _toolCallJson.Append(raw[..closeIdx]);
                var json = _toolCallJson.ToString();
                _toolCallJson.Clear();
                _inToolCall = false;
                if (TryParseTextualToolCalls(json, out var calls))
                {
                    result.Add(new LlmStreamChunk { Type = LlmStreamEventType.ToolCalls, ToolCalls = calls });
                }
                else
                {
                    result.Add(MakeText(LlmStreamEventType.Content, $"{ToolCallOpenTag}{json}{ToolCallCloseTag}"));
                }
                raw = raw[(closeIdx + ToolCallCloseTag.Length)..];
                continue;
            }

            if (_inThinking)
            {
                var closeIdx = raw.IndexOf(CloseTag, StringComparison.OrdinalIgnoreCase);
                if (closeIdx < 0)
                {
                    HoldBackAndEmit(result, raw, LlmStreamEventType.Thinking, CloseTag);
                    return result;
                }
                if (closeIdx > 0) result.Add(MakeText(LlmStreamEventType.Thinking, raw[..closeIdx]));
                _inThinking = false;
                raw = raw[(closeIdx + CloseTag.Length)..];
                continue;
            }

            var thinkingIdx = raw.IndexOf(OpenTag, StringComparison.OrdinalIgnoreCase);
            var toolCallIdx = raw.IndexOf(ToolCallOpenTag, StringComparison.OrdinalIgnoreCase);
            if (thinkingIdx < 0 && toolCallIdx < 0)
            {
                HoldBackAndEmit(result, raw, LlmStreamEventType.Content, OpenTag, ToolCallOpenTag);
                return result;
            }

            if (toolCallIdx >= 0 && (thinkingIdx < 0 || toolCallIdx < thinkingIdx))
            {
                if (toolCallIdx > 0) result.Add(MakeText(LlmStreamEventType.Content, raw[..toolCallIdx]));
                _inToolCall = true;
                _toolCallJson.Clear();
                raw = raw[(toolCallIdx + ToolCallOpenTag.Length)..];
                continue;
            }

            if (thinkingIdx > 0) result.Add(MakeText(LlmStreamEventType.Content, raw[..thinkingIdx]));
            _inThinking = true;
            raw = raw[(thinkingIdx + OpenTag.Length)..];
        }

        return result;
    }

    /// <summary>发出不可能再成为标签前缀的部分，其余挂起到下一个 delta。</summary>
    private void HoldBackAndEmit(List<LlmStreamChunk> result, string raw, LlmStreamEventType type, params string[] tags)
    {
        var held = tags.Max(tag => PartialTagSuffixLength(raw, tag));
        _pendingFragment = raw[(raw.Length - held)..];
        var emitLength = raw.Length - held;
        if (emitLength > 0) result.Add(MakeText(type, raw[..emitLength]));
    }

    /// <summary>raw 尾部能构成 tag 严格前缀的最长长度。</summary>
    private static int PartialTagSuffixLength(string raw, string tag)
    {
        for (var k = Math.Min(raw.Length, tag.Length - 1); k >= 1; k--)
        {
            if (tag.AsSpan().StartsWith(raw.AsSpan(raw.Length - k), StringComparison.OrdinalIgnoreCase))
                return k;
        }
        return 0;
    }

    private static bool TryParseTextualToolCalls(string json, out List<LlmToolCall> calls)
    {
        calls = [];
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;
            if (TryGetProperty(root, "tool_call", out var nested) && nested.ValueKind == JsonValueKind.Object)
                root = nested;

            if (TryGetProperty(root, "tool_calls", out var array) && array.ValueKind == JsonValueKind.Array)
            {
                foreach (var element in array.EnumerateArray())
                {
                    if (!TryParseTextualToolCall(element, calls)) return false;
                }
            }
            else if (!TryParseTextualToolCall(root, calls))
            {
                return false;
            }
            return calls.Count > 0;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool TryParseTextualToolCall(JsonElement element, List<LlmToolCall> calls)
    {
        if (element.ValueKind != JsonValueKind.Object) return false;
        var id = TryGetProperty(element, "id", out var idElement) && idElement.ValueKind == JsonValueKind.String
            ? idElement.GetString()
            : null;
        var source = TryGetProperty(element, "function", out var function) && function.ValueKind == JsonValueKind.Object
            ? function
            : element;
        if (!TryGetProperty(source, "name", out var nameElement)
            || nameElement.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(nameElement.GetString())) return false;

        var arguments = "{}";
        if (TryGetProperty(source, "arguments", out var args) || TryGetProperty(source, "parameters", out args))
        {
            if (args.ValueKind == JsonValueKind.Object)
            {
                arguments = args.GetRawText();
            }
            else if (args.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(args.GetString()))
            {
                arguments = args.GetString()!;
                try
                {
                    using var argsDoc = JsonDocument.Parse(arguments);
                    if (argsDoc.RootElement.ValueKind != JsonValueKind.Object) return false;
                }
                catch (JsonException)
                {
                    return false;
                }
            }
            else if (args.ValueKind != JsonValueKind.Null)
            {
                return false;
            }
        }

        calls.Add(new LlmToolCall
        {
            Id = string.IsNullOrWhiteSpace(id) ? $"text_call_{Guid.NewGuid():N}" : id,
            Name = nameElement.GetString()!,
            Arguments = arguments,
        });
        return true;
    }

    private static bool TryGetProperty(JsonElement element, string name, out JsonElement value)
    {
        foreach (var property in element.EnumerateObject())
        {
            if (!string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)) continue;
            value = property.Value;
            return true;
        }
        value = default;
        return false;
    }

    private static LlmStreamChunk MakeText(LlmStreamEventType type, string text) =>
        new() { Type = type, Text = text };
}