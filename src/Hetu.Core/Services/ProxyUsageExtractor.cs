using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

/// <summary>
/// 从上游响应里提取用量。代理是透传，响应体必须原样发给客户端，
/// 所以解析发生在拷贝过程中：非流式整体读 JSON，流式逐帧扫 SSE 的 data 行。
/// </summary>
public static class ProxyUsageExtractor
{
    /// <summary>
    /// 拷贝流并把每个完整的 SSE data 载荷交给 <paramref name="onData"/>。
    /// 逐行转发而不是整块缓冲，保证流式响应不因统计而变卡。
    /// </summary>
    public static async Task CopyWithSseScanAsync(Stream source, Stream destination, Action<string> onData, CancellationToken ct)
    {
        using var reader = new StreamReader(source, Encoding.UTF8);
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (line.StartsWith("data:", StringComparison.Ordinal))
                onData(line["data:".Length..].Trim());

            // SSE 规范允许 CR / LF / CRLF 作分隔，统一写 LF 即可
            await destination.WriteAsync(Encoding.UTF8.GetBytes(line + "\n"), ct);
            await destination.FlushAsync(ct);
        }
    }

    /// <summary>OpenAI 兼容：usage 在非流式响应顶层，或在流式的最后一帧。</summary>
    public static LlmUsage? FromOpenAi(string json)
    {
        if (TryParse(json) is not { } root) return null;
        if (!root.TryGetProperty("usage", out var usage) || usage.ValueKind != JsonValueKind.Object) return null;

        var cached = ReadInt(usage, "cached_tokens");
        if (cached == 0 && usage.TryGetProperty("prompt_tokens_details", out var details)
            && details.ValueKind == JsonValueKind.Object)
        {
            cached = ReadInt(details, "cached_tokens");
        }
        if (cached == 0)
        {
            // DeepSeek 等把命中/未命中分开报
            cached = ReadInt(usage, "prompt_cache_hit_tokens");
        }

        return new LlmUsage
        {
            PromptTokens = ReadInt(usage, "prompt_tokens"),
            CompletionTokens = ReadInt(usage, "completion_tokens"),
            TotalTokens = ReadInt(usage, "total_tokens"),
            CachedTokens = cached,
        };
    }

    /// <summary>
    /// Anthropic 用量分散在多个事件里：message_start 带输入与缓存，
    /// message_delta 带输出。逐帧喂进来累积，结束时取结果。
    /// </summary>
    public sealed class AnthropicAccumulator
    {
        private int _prompt;
        private int _completion;
        private int _cached;
        private bool _seen;

        public void Feed(string json)
        {
            if (TryParse(json) is not { } root) return;

            if (root.TryGetProperty("message", out var message)
                && message.ValueKind == JsonValueKind.Object
                && message.TryGetProperty("usage", out var start)
                && start.ValueKind == JsonValueKind.Object)
            {
                _prompt = ReadInt(start, "input_tokens");
                _cached = ReadInt(start, "cache_read_input_tokens");
                _seen = true;
            }

            if (root.TryGetProperty("usage", out var delta) && delta.ValueKind == JsonValueKind.Object)
            {
                var output = ReadInt(delta, "output_tokens");
                if (output > 0) _completion = output;
                if (ReadInt(delta, "input_tokens") > 0) _prompt = ReadInt(delta, "input_tokens");
                _seen = true;
            }
        }

        public LlmUsage? ToUsage()
            => _seen
                ? new LlmUsage
                {
                    PromptTokens = _prompt,
                    CompletionTokens = _completion,
                    TotalTokens = _prompt + _completion,
                    CachedTokens = _cached,
                }
                : null;
    }

    private static JsonElement? TryParse(string json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "[DONE]") return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }
        catch
        {
            // 上游可能发心跳或非 JSON 行，忽略即可
            return null;
        }
    }

    private static int ReadInt(JsonElement obj, string name)
        => obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)
            ? n
            : 0;
}
