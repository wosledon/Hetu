using System.Net;
using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.AI;

namespace Hetu.Core.Tests;

/// <summary>
/// Provider 用量采集回归测试。重点是「usage 在 finish_reason 之后的独立尾帧」这种
/// OpenAI 规范行为：曾经在看到 finish_reason 时就结束迭代，导致输出/总计/缓存全为空。
/// </summary>
public class LlmProviderUsageTests
{
    private static readonly JsonSerializerOptions CamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [Fact]
    public async Task ChatStreamAsync_用量在finish_reason之后的尾帧_仍能上报()
    {
        var provider = OpenAi(Sse(
            """data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"stop"}]}""",
            """data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":90}}}""",
            "data: [DONE]"));

        var frames = await CollectAsync(provider);

        var usage = ReadUsage(frames);
        Assert.NotNull(usage);
        Assert.Equal(120, usage.PromptTokens);
        Assert.Equal(30, usage.CompletionTokens);
        Assert.Equal(150, usage.TotalTokens);
        Assert.Equal(90, usage.CachedTokens);
        Assert.Equal("stop", ReadFinishReason(frames));
    }

    [Fact]
    public async Task ChatStreamAsync_用量与finish_reason同帧_仍能上报()
    {
        var provider = OpenAi(Sse(
            """data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}""",
            "data: [DONE]"));

        var usage = ReadUsage(await CollectAsync(provider));

        Assert.NotNull(usage);
        Assert.Equal(14, usage.TotalTokens);
    }

    [Fact]
    public async Task ChatStreamAsync_尾帧带用量且本轮有工具调用_两者都不丢()
    {
        var provider = OpenAi(Sse(
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"work_read_file","arguments":"{\"path\":\"a.ts\"}"}}]},"finish_reason":null}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}""",
            """data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":12,"total_tokens":62}}""",
            "data: [DONE]"));

        var frames = await CollectAsync(provider);

        Assert.Equal("tool_calls", ReadFinishReason(frames));
        Assert.NotNull(ReadUsage(frames));
        Assert.Contains(frames, f => f.Contains("\"tool_calls\"", StringComparison.Ordinal) && f.Contains("work_read_file", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ChatStreamAsync_DeepSeek风格命中字段_计入缓存()
    {
        var provider = OpenAi(Sse(
            """data: {"choices":[{"delta":{},"finish_reason":"stop"}]}""",
            """data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105,"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":36}}""",
            "data: [DONE]"));

        var usage = ReadUsage(await CollectAsync(provider));

        Assert.NotNull(usage);
        Assert.Equal(64, usage.CachedTokens);
    }

    [Fact]
    public async Task ChatStreamAsync_无尾帧且流直接结束_按stop收尾不抛异常()
    {
        var provider = OpenAi(Sse("""data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}"""));

        var frames = await CollectAsync(provider);

        Assert.Equal("stop", ReadFinishReason(frames));
        Assert.Null(ReadUsage(frames));
    }

    [Fact]
    public async Task ChatWithUsageAsync_非流式响应_带回用量()
    {
        var provider = OpenAi(
            """{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":20,"completion_tokens":3,"total_tokens":23}}""",
            "application/json");

        var result = await provider.ChatWithUsageAsync(
            [new LlmChatMessage { Role = "user", Content = "q" }], new ChatOptions());

        Assert.Equal("ok", result.Content);
        Assert.NotNull(result.Usage);
        Assert.Equal(23, result.Usage.TotalTokens);
    }

    [Fact]
    public async Task ChatStreamAsync_Anthropic缓存读写_计入完整Prompt规模()
    {
        var provider = Anthropic(Sse(
            """data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":90,"cache_creation_input_tokens":20}}}""",
            """data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}""",
            """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":30}}""",
            """data: {"type":"message_stop"}"""));

        var usage = ReadUsage(await CollectAsync(provider));

        Assert.NotNull(usage);
        // input_tokens 只含未命中缓存的部分，三项相加才是真实 Prompt
        Assert.Equal(120, usage.PromptTokens);
        Assert.Equal(30, usage.CompletionTokens);
        Assert.Equal(150, usage.TotalTokens);
        Assert.Equal(90, usage.CachedTokens);
        Assert.Equal(20, usage.CacheCreationTokens);
    }

    [Fact]
    public async Task ChatWithUsageAsync_Anthropic非流式_带回缓存用量()
    {
        var provider = Anthropic(
            """{"content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":5,"cache_read_input_tokens":40,"cache_creation_input_tokens":0,"output_tokens":7}}""",
            "application/json");

        var result = await provider.ChatWithUsageAsync(
            [new LlmChatMessage { Role = "user", Content = "q" }], new ChatOptions());

        Assert.Equal("ok", result.Content);
        Assert.NotNull(result.Usage);
        Assert.Equal(45, result.Usage.PromptTokens);
        Assert.Equal(40, result.Usage.CachedTokens);
        Assert.Equal(52, result.Usage.TotalTokens);
    }

    [Fact]
    public async Task ChatStreamAsync_Anthropic请求_工具系统提示与末条消息都挂缓存断点()
    {
        var handler = new StubHandler(Sse(
            """data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}""",
            """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}""",
            """data: {"type":"message_stop"}"""), "text/event-stream");
        var provider = Anthropic(handler);
        var options = new ChatOptions
        {
            SystemPrompt = "系统提示",
            Tools = [new LlmToolDefinition { Name = "t", Description = "d", ParametersSchema = JsonDocument.Parse("{}").RootElement }],
        };

        await foreach (var _ in provider.ChatStreamAsync([new LlmChatMessage { Role = "user", Content = "q" }], options))
        {
            // 只关心请求体，流内容丢弃
        }

        Assert.NotNull(handler.RequestBody);
        using var doc = JsonDocument.Parse(handler.RequestBody);
        var root = doc.RootElement;
        Assert.Equal("ephemeral", CacheType(root.GetProperty("tools")[0]));
        Assert.Equal("ephemeral", CacheType(root.GetProperty("system")[0]));
        var messagesEl = root.GetProperty("messages");
        var lastMessage = messagesEl[messagesEl.GetArrayLength() - 1];
        Assert.Equal("ephemeral", CacheType(lastMessage.GetProperty("content")[0]));
    }

    [Fact]
    public async Task ChatStreamAsync_Anthropic工具结果消息_断点挂在tool_result块上()
    {
        var handler = new StubHandler(Sse(
            """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}""",
            """data: {"type":"message_stop"}"""), "text/event-stream");
        var provider = Anthropic(handler);
        LlmChatMessage[] messages =
        [
            new() { Role = "user", Content = "q" },
            new() { Role = "assistant", Content = "", ToolCalls = [new LlmToolCall { Id = "call-1", Name = "t", Arguments = "{}" }] },
            new() { Role = "tool", ToolCallId = "call-1", Content = "result" },
        ];

        await foreach (var _ in provider.ChatStreamAsync(messages, new ChatOptions()))
        {
            // 只关心请求体
        }

        Assert.NotNull(handler.RequestBody);
        using var doc = JsonDocument.Parse(handler.RequestBody);
        var messagesEl = doc.RootElement.GetProperty("messages");
        var lastBlock = messagesEl[messagesEl.GetArrayLength() - 1].GetProperty("content")[0];
        Assert.Equal("tool_result", lastBlock.GetProperty("type").GetString());
        Assert.Equal("ephemeral", CacheType(lastBlock));
    }

    [Fact]
    public async Task ChatStreamAsync_Anthropic思考块_带签名完整上报()
    {
        var provider = Anthropic(Sse(
            """data: {"type":"content_block_start","content_block":{"type":"thinking"}}""",
            """data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"让我想想"}}""",
            """data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"sig-abc"}}""",
            """data: {"type":"content_block_stop"}""",
            """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}""",
            """data: {"type":"message_stop"}"""));

        var frames = await CollectAsync(provider);

        var frame = frames.FirstOrDefault(f => f.Contains("\"thinking_block\"", StringComparison.Ordinal));
        Assert.NotNull(frame);
        using var doc = JsonDocument.Parse(frame);
        Assert.Equal("让我想想", doc.RootElement.GetProperty("text").GetString());
        Assert.Equal("sig-abc", doc.RootElement.GetProperty("signature").GetString());
    }

    [Fact]
    public async Task ChatStreamAsync_Anthropic回传思考块_请求体带thinking与signature()
    {
        var handler = new StubHandler(Sse(
            """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}""",
            """data: {"type":"message_stop"}"""), "text/event-stream");
        var provider = Anthropic(handler);
        LlmChatMessage[] messages =
        [
            new() { Role = "user", Content = "q" },
            new()
            {
                Role = "assistant",
                Content = "",
                ToolCalls = [new LlmToolCall { Id = "call-1", Name = "t", Arguments = "{}" }],
                ThinkingBlocks = [new LlmThinkingBlock { Text = "推理", Signature = "sig" }],
            },
            new() { Role = "tool", ToolCallId = "call-1", Content = "r" },
        ];

        await foreach (var _ in provider.ChatStreamAsync(messages, new ChatOptions()))
        {
            // 只关心请求体
        }

        Assert.NotNull(handler.RequestBody);
        using var doc = JsonDocument.Parse(handler.RequestBody);
        var firstBlock = doc.RootElement.GetProperty("messages")[1].GetProperty("content")[0];
        Assert.Equal("thinking", firstBlock.GetProperty("type").GetString());
        Assert.Equal("推理", firstBlock.GetProperty("thinking").GetString());
        Assert.Equal("sig", firstBlock.GetProperty("signature").GetString());
    }

    private static string? CacheType(JsonElement block)
        => block.TryGetProperty("cache_control", out var cache) ? cache.GetProperty("type").GetString() : null;

    private static OpenAiLlmProvider OpenAi(string body, string contentType = "text/event-stream")
        => new(new HttpClient(new StubHandler(body, contentType)) { BaseAddress = new Uri("https://unit.test/v1/") }, "key", "model");

    private static AnthropicLlmProvider Anthropic(string body, string contentType = "text/event-stream")
        => Anthropic(new StubHandler(body, contentType));

    private static AnthropicLlmProvider Anthropic(StubHandler handler)
        => new(new HttpClient(handler) { BaseAddress = new Uri("https://unit.test/v1/") }, "key", "model");

    private static string Sse(params string[] lines) => string.Concat(lines.Select(l => l + "\n\n"));

    private static async Task<List<string>> CollectAsync(ILLMProvider provider)
    {
        var frames = new List<string>();
        await foreach (var frame in provider.ChatStreamAsync(
            [new LlmChatMessage { Role = "user", Content = "q" }], new ChatOptions()))
        {
            frames.Add(frame);
        }
        return frames;
    }

    private static LlmUsage? ReadUsage(List<string> frames)
    {
        foreach (var frame in frames)
        {
            using var doc = JsonDocument.Parse(frame);
            if (doc.RootElement.TryGetProperty("type", out var type) && type.GetString() == "usage")
                return doc.RootElement.GetProperty("usage").Deserialize<LlmUsage>(CamelCase);
        }
        return null;
    }

    private static string? ReadFinishReason(List<string> frames)
    {
        foreach (var frame in frames)
        {
            using var doc = JsonDocument.Parse(frame);
            if (doc.RootElement.TryGetProperty("type", out var type) && type.GetString() == "finish")
                return doc.RootElement.GetProperty("reason").GetString();
        }
        return null;
    }

    private sealed class StubHandler(string body, string contentType) : HttpMessageHandler
    {
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestBody = request.Content == null
                ? null
                : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, contentType),
            };
        }
    }
}