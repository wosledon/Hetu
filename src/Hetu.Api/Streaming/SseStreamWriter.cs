using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;

namespace Hetu.Api.Streaming;

/// <summary>
/// SSE streaming helper that handles chunk emission, thinking tag parsing,
/// and structured JSON event writing for the chat stream.
/// </summary>
public class SseStreamWriter
{
    private readonly HttpResponse _response;
    private readonly CancellationToken _cancellationToken;

    public SseStreamWriter(HttpResponse response, CancellationToken cancellationToken)
    {
        _response = response;
        _cancellationToken = cancellationToken;
    }

    public async Task WriteEventAsync(string data)
    {
        await _response.WriteAsync($"data: {data}\n\n", _cancellationToken);
        await _response.Body.FlushAsync(_cancellationToken);
    }

    public Task WriteJsonAsync(object payload)
        => WriteEventAsync(JsonSerializer.Serialize(payload, JsonDefaults.CamelCase));

    public Task WriteErrorAsync(string message) => WriteEventAsync($"[ERROR] {message}");

    public Task WriteDebugAsync(string text) => WriteJsonAsync(new { type = "debug", text });
}

/// <summary>
/// Parses an LLM stream for &lt;thinking&gt;...&lt;/thinking&gt; tags and emits
/// content/thinking chunks via the provided callback.
/// </summary>
public class ThinkingTagStreamParser
{
    private const string OpenTag = "<thinking>";
    private const string CloseTag = "</thinking>";

    private readonly Func<string, string, Task> _emitChunk;
    private bool _inThinking;
    private string _pendingTagFragment = "";

    public ThinkingTagStreamParser(Func<string, string, Task> emitChunk)
    {
        _emitChunk = emitChunk;
    }

    public async Task ParseAsync(string delta)
    {
        // Resume the fragment held back from the previous delta, otherwise a tag split
        // across two chunks would be lost.
        var raw = _pendingTagFragment + delta;
        _pendingTagFragment = "";

        while (raw.Length > 0)
        {
            if (_inThinking)
            {
                var closeIdx = raw.IndexOf(CloseTag, StringComparison.OrdinalIgnoreCase);
                if (closeIdx < 0)
                {
                    await EmitRemainderAsync(raw, CloseTag, "thinking");
                    return;
                }
                if (closeIdx > 0)
                    await _emitChunk("thinking", raw[..closeIdx]);
                _inThinking = false;
                raw = raw[(closeIdx + CloseTag.Length)..];
            }
            else
            {
                var openIdx = raw.IndexOf(OpenTag, StringComparison.OrdinalIgnoreCase);
                if (openIdx < 0)
                {
                    await EmitRemainderAsync(raw, OpenTag, "content");
                    return;
                }
                if (openIdx > 0)
                    await _emitChunk("content", raw[..openIdx]);
                _inThinking = true;
                raw = raw[(openIdx + OpenTag.Length)..];
                await _emitChunk("thinking", "");
            }
        }
    }

    /// <summary>
    /// Releases text still held back as a possible tag prefix. Call once the stream has ended.
    /// </summary>
    public async Task FlushAsync()
    {
        if (_pendingTagFragment.Length == 0)
            return;

        var fragment = _pendingTagFragment;
        _pendingTagFragment = "";
        await _emitChunk(_inThinking ? "thinking" : "content", fragment);
    }

    /// <summary>
    /// Emits everything that cannot be the start of <paramref name="tag"/> and holds the rest back
    /// for the next delta.
    /// </summary>
    private async Task EmitRemainderAsync(string raw, string tag, string emitType)
    {
        var held = FindPartialTagSuffix(raw, tag);
        _pendingTagFragment = raw[(raw.Length - held)..];
        var emitLength = raw.Length - held;
        if (emitLength > 0)
            await _emitChunk(emitType, raw[..emitLength]);
    }

    /// <summary>
    /// Length of the longest suffix of <paramref name="raw"/> that is a strict prefix of <paramref name="tag"/>.
    /// </summary>
    private static int FindPartialTagSuffix(string raw, string tag)
    {
        for (var k = Math.Min(raw.Length, tag.Length - 1); k >= 1; k--)
        {
            if (tag.AsSpan().StartsWith(raw.AsSpan(raw.Length - k), StringComparison.OrdinalIgnoreCase))
                return k;
        }
        return 0;
    }
}

/// <summary>
/// Processes a chat stream from an LLM provider, routing structured JSON deltas
/// and raw text through the thinking tag parser.
/// </summary>
public static class ChatStreamProcessor
{
    /// <summary>
    /// Streams from the provider, emitting content/thinking chunks and capturing tool calls.
    /// Returns the accumulated content/thinking buffers and any pending tool calls.
    /// </summary>
    public static async Task<(StringBuilder content, StringBuilder thinking, List<LlmToolCall>? toolCalls, LlmUsage? usage)> ProcessStreamAsync(
        ILLMProvider provider,
        List<LlmChatMessage> chatMessages,
        ChatOptions options,
        SseStreamWriter writer,
        CancellationToken cancellationToken)
    {
        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        List<LlmToolCall>? pendingToolCalls = null;
        LlmUsage? usage = null;

        async Task EmitChunk(string type, string text)
        {
            await writer.WriteJsonAsync(new { type, text });
            if (type == "thinking") thinkingSb.Append(text);
            else if (type == "content") contentSb.Append(text);
        }

        var parser = new ThinkingTagStreamParser(EmitChunk);

        await foreach (var delta in provider.ChatStreamAsync(chatMessages, options, cancellationToken))
        {
            // Try structured JSON (native thinking); anything else goes through tag parsing.
            try
            {
                using var doc = JsonDocument.Parse(delta);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Object
                    && root.TryGetProperty("type", out var typeEl)
                    && typeEl.ValueKind == JsonValueKind.String)
                {
                    var typeStr = typeEl.GetString() ?? "";
                    var text = root.TryGetProperty("text", out var textEl) && textEl.ValueKind == JsonValueKind.String
                        ? textEl.GetString() ?? ""
                        : "";
                    switch (typeStr)
                    {
                        case "tool_calls":
                            if (root.TryGetProperty("toolCalls", out var tcArray))
                                pendingToolCalls = JsonSerializer.Deserialize<List<LlmToolCall>>(tcArray.GetRawText(), JsonDefaults.CamelCase);
                            break;
                        case "usage":
                            if (root.TryGetProperty("usage", out var usageEl))
                                usage = JsonSerializer.Deserialize<LlmUsage>(usageEl.GetRawText(), JsonDefaults.CamelCase);
                            break;
                        default:
                            await EmitChunk(typeStr, text);
                            break;
                    }
                    continue;
                }
            }
            catch (JsonException) { /* Not JSON, proceed with tag parsing */ }

            await parser.ParseAsync(delta);
        }

        await parser.FlushAsync();

        return (contentSb, thinkingSb, pendingToolCalls, usage);
    }
}