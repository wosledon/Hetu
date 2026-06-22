using System.Runtime.CompilerServices;
using System.Text;

namespace Hetu.Api.Streaming;

/// <summary>
/// SSE streaming helper that handles chunk emission, thinking tag parsing,
/// and structured JSON event writing for the chat stream.
/// </summary>
public class SseStreamWriter
{
    private readonly HttpResponse _response;
    private readonly CancellationToken _cancellationToken;
    private readonly System.Text.Json.JsonSerializerOptions _jsonOptions;

    public SseStreamWriter(HttpResponse response, CancellationToken cancellationToken)
    {
        _response = response;
        _cancellationToken = cancellationToken;
        _jsonOptions = new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase };
    }

    public async Task WriteEventAsync(string data)
    {
        await _response.WriteAsync($"data: {data}\n\n", _cancellationToken);
        await _response.Body.FlushAsync(_cancellationToken);
    }

    public async Task WriteJsonAsync(object payload)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(payload, _jsonOptions);
        await _response.WriteAsync($"data: {json}\n\n", _cancellationToken);
        await _response.Body.FlushAsync(_cancellationToken);
    }

    public async Task WriteErrorAsync(string message)
    {
        await WriteEventAsync($"[ERROR] {message}");
    }

    public async Task WriteDebugAsync(string text)
    {
        await WriteJsonAsync(new { type = "debug", text });
    }
}

/// <summary>
/// Parses an LLM stream for &lt;thinking&gt;...&lt;/thinking&gt; tags and emits
/// content/thinking chunks via the provided callback.
/// </summary>
public class ThinkingTagStreamParser
{
    private readonly Func<string, string, Task> _emitChunk;
    private bool _inThinking;
    private string _thinkTagBuffer = "";

    public ThinkingTagStreamParser(Func<string, string, Task> emitChunk)
    {
        _emitChunk = emitChunk;
    }

    public async Task ParseAsync(string delta)
    {
        var raw = delta;

        while (raw.Length > 0)
        {
            if (!_inThinking)
            {
                var openIdx = raw.IndexOf("<thinking>", StringComparison.OrdinalIgnoreCase);
                if (openIdx >= 0)
                {
                    if (openIdx > 0)
                        await _emitChunk("content", raw[..openIdx]);
                    _inThinking = true;
                    raw = raw[(openIdx + "<thinking>".Length)..];
                    await _emitChunk("thinking", "");
                }
                else
                {
                    var partial = false;
                    for (int k = 1; k < raw.Length && k <= "<thinking>".Length; k++)
                    {
                        if ("<thinking>".StartsWith(raw[^k..], StringComparison.OrdinalIgnoreCase))
                        {
                            _thinkTagBuffer = raw[^k..];
                            if (k < raw.Length)
                                await _emitChunk("content", raw[..^k]);
                            partial = true;
                            break;
                        }
                    }
                    if (!partial)
                        await _emitChunk("content", raw);
                    raw = "";
                }
            }
            else
            {
                var closeIdx = raw.IndexOf("</thinking>", StringComparison.OrdinalIgnoreCase);
                if (closeIdx >= 0)
                {
                    var thinkingText = raw[..closeIdx];
                    if (!string.IsNullOrEmpty(thinkingText))
                        await _emitChunk("thinking", thinkingText);
                    _inThinking = false;
                    raw = raw[(closeIdx + "</thinking>".Length)..];
                }
                else
                {
                    var partial = false;
                    for (int k = 1; k < raw.Length && k <= "</thinking>".Length; k++)
                    {
                        if ("</thinking>".StartsWith(raw[^k..], StringComparison.OrdinalIgnoreCase))
                        {
                            if (k < raw.Length)
                                await _emitChunk("thinking", raw[..^k]);
                            _thinkTagBuffer = raw[^k..];
                            partial = true;
                            break;
                        }
                    }
                    if (!partial)
                        await _emitChunk("thinking", raw);
                    raw = "";
                }
            }
        }
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
    public static async Task<(StringBuilder content, StringBuilder thinking, List<Hetu.Core.Interfaces.LlmToolCall>? toolCalls)> ProcessStreamAsync(
        Hetu.Core.Interfaces.ILLMProvider provider,
        List<Hetu.Core.Interfaces.LlmChatMessage> chatMessages,
        Hetu.Core.Interfaces.ChatOptions options,
        SseStreamWriter writer,
        CancellationToken cancellationToken)
    {
        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        List<Hetu.Core.Interfaces.LlmToolCall>? pendingToolCalls = null;
        var jsonOptions = new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase };

        async Task EmitChunk(string type, string text)
        {
            await writer.WriteJsonAsync(new { type, text });
            if (type == "thinking") thinkingSb.Append(text);
            if (type == "content") contentSb.Append(text);
        }

        var parser = new ThinkingTagStreamParser(EmitChunk);

        await foreach (var delta in provider.ChatStreamAsync(chatMessages, options, cancellationToken))
        {
            // Try structured JSON (native thinking)
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(delta);
                if (doc.RootElement.TryGetProperty("type", out var typeEl))
                {
                    var typeStr = typeEl.GetString();
                    var text = doc.RootElement.TryGetProperty("text", out var textEl) ? textEl.GetString() ?? "" : "";
                    if (typeStr == "tool_calls")
                    {
                        if (doc.RootElement.TryGetProperty("toolCalls", out var tcArray))
                        {
                            pendingToolCalls = System.Text.Json.JsonSerializer.Deserialize<List<Hetu.Core.Interfaces.LlmToolCall>>(tcArray.GetRawText(), jsonOptions);
                        }
                    }
                    else
                    {
                        await EmitChunk(typeStr ?? "content", text);
                    }
                    continue;
                }
            }
            catch { /* Not JSON, proceed with tag parsing */ }

            await parser.ParseAsync(delta);
        }

        return (contentSb, thinkingSb, pendingToolCalls);
    }
}