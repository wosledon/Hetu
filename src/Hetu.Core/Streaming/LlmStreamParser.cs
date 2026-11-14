using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;

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
    /// <summary>用量统计（流末一次性给出）</summary>
    Usage,
    /// <summary>
    /// 流结束原因（OpenAI finish_reason / Anthropic stop_reason）：
    /// length / max_tokens 表示被输出上限截断，消费方可据此续写。
    /// </summary>
    Finish,
}

/// <summary>单个解析结果。ToolCalls / Usage / Finish 事件只在流末出现一次。</summary>
public sealed class LlmStreamChunk
{
    public required LlmStreamEventType Type { get; init; }
    public string Text { get; init; } = string.Empty;
    public List<LlmToolCall>? ToolCalls { get; init; }
    public LlmUsage? Usage { get; init; }
    /// <summary>Finish 事件的结束原因；其余事件为空</summary>
    public string? Reason { get; init; }
}

/// <summary>
/// 统一的 LLM 流解析器：把 Provider 输出的 delta 归一化为
/// <see cref="LlmStreamChunk"/> 序列，供 Agent Loop、SSE 控制器等所有消费方共用。
/// <para>
/// 处理两类输入：
/// 1. Provider 的结构化 JSON 帧（OpenAI / Anthropic 适配器输出）：
///    <c>{"type":"content","text":...}</c>、<c>{"type":"thinking","text":...}</c>、
///    <c>{"type":"tool_calls","toolCalls":[...]}</c>、<c>{"type":"usage","usage":{...}}</c>；
/// 2. 纯文本 delta：按 <c>&lt;thinking&gt;...&lt;/thinking&gt;</c> 标签切分成思考 / 正文，
///    跨 delta 的半截标签会挂起，由 <see cref="Flush"/> 收尾释放。
/// </para>
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

        return TryParseStructured(delta, out var structured)
            ? structured
            : ParseTagged(delta);
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

    /// <summary>解析 Provider 的结构化 JSON 帧；非结构化返回 false。</summary>
    private bool TryParseStructured(string delta, out IReadOnlyList<LlmStreamChunk> chunks)
    {
        chunks = Array.Empty<LlmStreamChunk>();
        try
        {
            using var doc = JsonDocument.Parse(delta);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("type", out var typeEl)
                || typeEl.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            var type = typeEl.GetString() ?? "";
            switch (type)
            {
                case "tool_calls":
                {
                    var calls = new List<LlmToolCall>();
                    var valid = TryGetProperty(root, "toolCalls", out var tcEl) && tcEl.ValueKind == JsonValueKind.Array;
                    if (valid)
                    {
                        foreach (var element in tcEl.EnumerateArray())
                        {
                            if (TryParseTextualToolCall(element, calls)) continue;
                            valid = false;
                            break;
                        }
                    }
                    chunks = valid && calls.Count > 0
                        ? new[] { new LlmStreamChunk { Type = LlmStreamEventType.ToolCalls, ToolCalls = calls } }
                        : new[] { new LlmStreamChunk { Type = LlmStreamEventType.Finish, Reason = "invalid_tool_call" } };
                    return true;
                }
                case "tool_call":
                {
                    var element = TryGetProperty(root, "toolCall", out var single) ? single : root;
                    var calls = new List<LlmToolCall>();
                    chunks = TryParseTextualToolCall(element, calls)
                        ? new[] { new LlmStreamChunk { Type = LlmStreamEventType.ToolCalls, ToolCalls = calls } }
                        : new[] { new LlmStreamChunk { Type = LlmStreamEventType.Finish, Reason = "invalid_tool_call" } };
                    return true;
                }
                case "usage":
                {
                    var usage = root.TryGetProperty("usage", out var usageEl)
                        ? JsonSerializer.Deserialize<LlmUsage>(usageEl.GetRawText(), JsonDefaults.CamelCase)
                        : null;
                    chunks = new[] { new LlmStreamChunk { Type = LlmStreamEventType.Usage, Usage = usage } };
                    return true;
                }
                case "finish":
                {
                    var reason = root.TryGetProperty("reason", out var reasonEl) && reasonEl.ValueKind == JsonValueKind.String
                        ? reasonEl.GetString()
                        : null;
                    chunks = new[] { new LlmStreamChunk { Type = LlmStreamEventType.Finish, Reason = reason } };
                    return true;
                }
                default:
                {
                    var text = root.TryGetProperty("text", out var textEl) && textEl.ValueKind == JsonValueKind.String
                        ? textEl.GetString() ?? ""
                        : "";
                    chunks = type == "thinking"
                        ? new[] { MakeText(LlmStreamEventType.Thinking, text) }
                        : ParseTagged(text);
                    return true;
                }
            }
        }
        catch (JsonException)
        {
            return false;
        }
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
