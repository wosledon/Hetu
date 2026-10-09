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
}

/// <summary>单个解析结果。ToolCalls / Usage 事件只在流末出现一次。</summary>
public sealed class LlmStreamChunk
{
    public required LlmStreamEventType Type { get; init; }
    public string Text { get; init; } = string.Empty;
    public List<LlmToolCall>? ToolCalls { get; init; }
    public LlmUsage? Usage { get; init; }
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

    private bool _inThinking;
    private string _pendingFragment = "";

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
        if (_pendingFragment.Length == 0) return Array.Empty<LlmStreamChunk>();

        var fragment = _pendingFragment;
        _pendingFragment = "";
        return new[] { MakeText(_inThinking ? LlmStreamEventType.Thinking : LlmStreamEventType.Content, fragment) };
    }

    /// <summary>解析 Provider 的结构化 JSON 帧；非结构化返回 false。</summary>
    private static bool TryParseStructured(string delta, out IReadOnlyList<LlmStreamChunk> chunks)
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
                    var calls = root.TryGetProperty("toolCalls", out var tcEl)
                        ? JsonSerializer.Deserialize<List<LlmToolCall>>(tcEl.GetRawText(), JsonDefaults.CamelCase)
                        : null;
                    chunks = new[]
                    {
                        new LlmStreamChunk
                        {
                            Type = LlmStreamEventType.ToolCalls,
                            ToolCalls = calls is { Count: > 0 } ? calls : null,
                        },
                    };
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
                default:
                {
                    var text = root.TryGetProperty("text", out var textEl) && textEl.ValueKind == JsonValueKind.String
                        ? textEl.GetString() ?? ""
                        : "";
                    chunks = new[]
                    {
                        MakeText(type == "thinking" ? LlmStreamEventType.Thinking : LlmStreamEventType.Content, text),
                    };
                    return true;
                }
            }
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>纯文本 delta 的 thinking 标签切分。</summary>
    private IReadOnlyList<LlmStreamChunk> ParseTagged(string delta)
    {
        var result = new List<LlmStreamChunk>();
        var raw = _pendingFragment + delta;
        _pendingFragment = "";

        while (raw.Length > 0)
        {
            if (_inThinking)
            {
                var closeIdx = raw.IndexOf(CloseTag, StringComparison.OrdinalIgnoreCase);
                if (closeIdx < 0)
                {
                    HoldBackAndEmit(result, raw, CloseTag, LlmStreamEventType.Thinking);
                    return result;
                }
                if (closeIdx > 0) result.Add(MakeText(LlmStreamEventType.Thinking, raw[..closeIdx]));
                _inThinking = false;
                raw = raw[(closeIdx + CloseTag.Length)..];
            }
            else
            {
                var openIdx = raw.IndexOf(OpenTag, StringComparison.OrdinalIgnoreCase);
                if (openIdx < 0)
                {
                    HoldBackAndEmit(result, raw, OpenTag, LlmStreamEventType.Content);
                    return result;
                }
                if (openIdx > 0) result.Add(MakeText(LlmStreamEventType.Content, raw[..openIdx]));
                _inThinking = true;
                raw = raw[(openIdx + OpenTag.Length)..];
            }
        }

        return result;
    }

    /// <summary>发出不可能再成为标签前缀的部分，其余挂起到下一个 delta。</summary>
    private void HoldBackAndEmit(List<LlmStreamChunk> result, string raw, string tag, LlmStreamEventType type)
    {
        var held = PartialTagSuffixLength(raw, tag);
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

    private static LlmStreamChunk MakeText(LlmStreamEventType type, string text) =>
        new() { Type = type, Text = text };
}
