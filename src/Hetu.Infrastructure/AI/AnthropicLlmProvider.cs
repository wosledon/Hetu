using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Hetu.Core.Interfaces;

namespace Hetu.Infrastructure.AI;

public class AnthropicLlmProvider : ILLMProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private readonly string _modelId;
    private const string AnthropicVersion = "2023-06-01";

    public string ProviderType => "anthropic";
    public bool SupportsStreaming => true;

    public AnthropicLlmProvider(HttpClient httpClient, string apiKey, string modelId)
    {
        _httpClient = httpClient;
        _apiKey = apiKey;
        _modelId = modelId;
    }

    public async Task<string> ChatAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default)
        => (await ChatWithUsageAsync(messages, options, cancellationToken)).Content;

    public async Task<LlmChatResult> ChatWithUsageAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default)
    {
        var (systemPrompt, requestMessages) = BuildMessages(messages);
        var requestBody = CreateMessagesRequest(requestMessages, false, options, systemPrompt);
        using var request = CreateRequest("messages", requestBody);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        // 必须用 snake_case 选项：cache_read_input_tokens 等字段在默认 web 选项下读不到
        var result = await response.Content.ReadFromJsonAsync<AnthropicMessageResponse>(JsonOptions, cancellationToken);
        return new LlmChatResult
        {
            Content = result?.Content?.FirstOrDefault(c => c.Type == "text")?.Text ?? string.Empty,
            Usage = ToUsage(result?.Usage),
        };
    }

    private static LlmUsage? ToUsage(AnthropicUsage? usage)
    {
        if (usage == null) return null;
        var prompt = usage.FullPromptTokens;
        return new LlmUsage
        {
            PromptTokens = prompt,
            CompletionTokens = usage.OutputTokens,
            TotalTokens = prompt + usage.OutputTokens,
            CachedTokens = usage.CacheReadInputTokens,
            CacheCreationTokens = usage.CacheCreationInputTokens,
        };
    }

    public async IAsyncEnumerable<string> ChatStreamAsync(
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var (systemPrompt, requestMessages) = BuildMessages(messages);
        var requestBody = CreateMessagesRequest(requestMessages, true, options, systemPrompt);
        using var request = CreateRequest("messages", requestBody);
        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        // Track tool use blocks across stream events
        var currentToolUseId = "";
        var currentToolName = "";
        var currentToolArgs = new StringBuilder();
        var hasToolUse = false;
        // 思考块要连同签名一起回传，下一轮请求才能让模型接着上次推理继续
        var currentThinking = new StringBuilder();
        var currentThinkingSignature = new StringBuilder();
        var inThinkingBlock = false;
        // message_start 给输入侧用量，message_delta 给输出侧用量，合起来才是完整用量
        var streamInputTokens = 0;
        var streamCachedTokens = 0;
        var streamCacheCreationTokens = 0;

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line == null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (!line.StartsWith("data: ")) continue;

            var data = line[6..];

            AnthropicStreamEvent? evt = null;
            try
            {
                evt = JsonSerializer.Deserialize<AnthropicStreamEvent>(data, JsonOptions);
            }
            catch
            {
                continue;
            }

            switch (evt?.Type)
            {
                case "message_start":
                    {
                        var startUsage = evt.Message?.Usage;
                        streamInputTokens = startUsage?.InputTokens ?? 0;
                        streamCachedTokens = startUsage?.CacheReadInputTokens ?? 0;
                        streamCacheCreationTokens = startUsage?.CacheCreationInputTokens ?? 0;
                        break;
                    }

                case "content_block_start":
                    {
                        var block = evt.ContentBlock;
                        if (block?.Type == "tool_use")
                        {
                            currentToolUseId = block.Id ?? "";
                            currentToolName = block.Name ?? "";
                            currentToolArgs.Clear();
                            hasToolUse = true;
                        }
                        else if (block?.Type == "thinking")
                        {
                            currentThinking.Clear();
                            currentThinkingSignature.Clear();
                            inThinkingBlock = true;
                        }
                        break;
                    }

                case "content_block_delta":
                    {
                        var delta = evt.Delta;
                        if (delta?.Type == "thinking_delta" && !string.IsNullOrEmpty(delta.Thinking))
                        {
                            currentThinking.Append(delta.Thinking);
                            yield return $"{{\"type\":\"thinking\",\"text\":{JsonSerializer.Serialize(delta.Thinking)}}}";
                        }
                        else if (delta?.Type == "signature_delta" && !string.IsNullOrEmpty(delta.Signature))
                        {
                            currentThinkingSignature.Append(delta.Signature);
                        }
                        else if (delta?.Type == "text_delta" && !string.IsNullOrEmpty(delta.Text))
                        {
                            yield return $"{{\"type\":\"content\",\"text\":{JsonSerializer.Serialize(delta.Text)}}}";
                        }
                        else if (delta?.Type == "input_json_delta" && !string.IsNullOrEmpty(delta.PartialJson))
                        {
                            currentToolArgs.Append(delta.PartialJson);
                        }
                        break;
                    }

                case "content_block_stop":
                    {
                        if (inThinkingBlock)
                        {
                            inThinkingBlock = false;
                            yield return JsonSerializer.Serialize(new
                            {
                                type = "thinking_block",
                                text = currentThinking.ToString(),
                                signature = currentThinkingSignature.ToString(),
                            }, JsonOptionsOut);
                        }
                        if (hasToolUse && !string.IsNullOrEmpty(currentToolUseId))
                        {
                            // A tool_use block completed
                            var toolCall = new LlmToolCall
                            {
                                Id = currentToolUseId,
                                Name = currentToolName,
                                Arguments = currentToolArgs.Length > 0 ? currentToolArgs.ToString() : "{}"
                            };
                            yield return JsonSerializer.Serialize(new
                            {
                                type = "tool_calls",
                                toolCalls = new[] { toolCall }
                            }, JsonOptionsOut);

                            currentToolUseId = "";
                            currentToolName = "";
                            currentToolArgs.Clear();
                        }
                        break;
                    }

                case "message_delta":
                    {
                        // 输出侧用量与停止原因在同一个事件里：先上报用量，再透传结束原因（max_tokens = 被截断可续写）
                        var deltaUsage = evt.Usage;
                        var outputTokens = deltaUsage?.OutputTokens ?? 0;
                        // 部分中转会在 message_delta 里重复带输入侧用量，非零时以它为准
                        if (deltaUsage != null)
                        {
                            if (deltaUsage.InputTokens > 0) streamInputTokens = deltaUsage.InputTokens;
                            if (deltaUsage.CacheReadInputTokens > 0) streamCachedTokens = deltaUsage.CacheReadInputTokens;
                            if (deltaUsage.CacheCreationInputTokens > 0) streamCacheCreationTokens = deltaUsage.CacheCreationInputTokens;
                        }
                        // Anthropic 的 input_tokens 不含缓存部分，三项相加才是真实 Prompt 规模
                        var promptTokens = streamInputTokens + streamCachedTokens + streamCacheCreationTokens;
                        if (promptTokens > 0 || outputTokens > 0)
                        {
                            yield return JsonSerializer.Serialize(new
                            {
                                type = "usage",
                                usage = new
                                {
                                    promptTokens,
                                    completionTokens = outputTokens,
                                    totalTokens = promptTokens + outputTokens,
                                    cachedTokens = streamCachedTokens,
                                    cacheCreationTokens = streamCacheCreationTokens,
                                },
                            }, JsonOptionsOut);
                        }
                        var stop = evt.Delta?.StopReason;
                        if (!string.IsNullOrEmpty(stop))
                        {
                            yield return JsonSerializer.Serialize(new { type = "finish", reason = stop }, JsonOptionsOut);
                        }
                        break;
                    }

                case "message_stop":
                    {
                        yield break;
                    }
            }
        }

        // 未等到 message_delta 就断流：按正常结束兜底，避免消费方拿不到结束原因
        yield return JsonSerializer.Serialize(new { type = "finish", reason = "stop" }, JsonOptionsOut);
    }

    public async Task<string> CompleteAsync(string prompt, CompletionOptions options, CancellationToken cancellationToken = default)
    {
        var messages = new List<LlmChatMessage>
        {
            new() { Role = "user", Content = prompt }
        };
        return await ChatAsync(messages, new ChatOptions
        {
            ModelId = options.ModelId,
            SystemPrompt = options.SystemPrompt,
            Temperature = options.Temperature,
            MaxTokens = options.MaxTokens
        }, cancellationToken);
    }

    /// <summary>
    /// Build Anthropic message format. Handles user, assistant, and tool roles.
    /// Anthropic uses content block arrays for tool_use and tool_result.
    /// 内容块用字典承载，便于在末尾挂 cache_control 断点。
    /// </summary>
    private static (string? SystemPrompt, List<AnthropicMessage> Messages) BuildMessages(IReadOnlyList<LlmChatMessage> messages)
    {
        var result = new List<AnthropicMessage>();

        foreach (var msg in messages)
        {
            if (msg.Role == "tool")
            {
                // Tool result: send as user message with tool_result content block
                result.Add(new AnthropicMessage
                {
                    Role = "user",
                    ContentBlocks =
                    [
                        new Dictionary<string, object>
                        {
                            ["type"] = "tool_result",
                            ["tool_use_id"] = msg.ToolCallId ?? "",
                            ["content"] = msg.Content,
                        }
                    ]
                });
                continue;
            }

            if (msg.Role == "assistant" && msg.ToolCalls is { Count: > 0 })
            {
                // Assistant with tool_use content blocks
                var blocks = new List<Dictionary<string, object>>();
                // 思考块必须排在最前且原样回传（含签名），否则模型丢失上一轮推理、每轮从零重想
                if (msg.ThinkingBlocks != null)
                {
                    foreach (var thinking in msg.ThinkingBlocks)
                    {
                        if (string.IsNullOrEmpty(thinking.Text)) continue;
                        var block = new Dictionary<string, object>
                        {
                            ["type"] = "thinking",
                            ["thinking"] = thinking.Text,
                        };
                        if (!string.IsNullOrEmpty(thinking.Signature)) block["signature"] = thinking.Signature;
                        blocks.Add(block);
                    }
                }
                if (!string.IsNullOrWhiteSpace(msg.Content))
                    blocks.Add(TextBlock(msg.Content));
                foreach (var tc in msg.ToolCalls)
                {
                    // Parse arguments as JsonElement for Anthropic's input field
                    JsonElement inputEl;
                    try { inputEl = JsonSerializer.Deserialize<JsonElement>(tc.Arguments); }
                    catch { inputEl = JsonSerializer.Deserialize<JsonElement>("{}"); }
                    blocks.Add(new Dictionary<string, object>
                    {
                        ["type"] = "tool_use",
                        ["id"] = tc.Id,
                        ["name"] = tc.Name,
                        ["input"] = inputEl,
                    });
                }
                result.Add(new AnthropicMessage { Role = "assistant", ContentBlocks = blocks });
                continue;
            }

            // Normal user/assistant messages
            if (msg.ContentParts != null && msg.ContentParts.Count > 0)
            {
                var blocks = new List<Dictionary<string, object>>();
                foreach (var part in msg.ContentParts)
                {
                    if (part.Type == "text" && part.Text != null)
                        blocks.Add(TextBlock(part.Text));
                    else if (part.Type == "image_url" && part.ImageUrl != null)
                        blocks.Add(new Dictionary<string, object>
                        {
                            ["type"] = "image",
                            ["source"] = new Dictionary<string, object>
                            {
                                ["type"] = "base64",
                                ["media_type"] = part.MediaType ?? "image/png",
                                ["data"] = part.ImageUrl,
                            },
                        });
                }
                result.Add(new AnthropicMessage { Role = msg.Role, ContentBlocks = blocks });
            }
            else
            {
                result.Add(new AnthropicMessage { Role = msg.Role, Content = msg.Content });
            }
        }

        // Extract system prompt from first message if it's from options (handled by caller)
        return (null, result);
    }

    private static Dictionary<string, object> TextBlock(string text)
        => new() { ["type"] = "text", ["text"] = text };

    /// <summary>
    /// 解析 Claude 扩展思考的 Token 预算：优先使用显式预算；
    /// 否则按强度等级折算（off/none 返回 null，表示不启用扩展思考）。
    /// </summary>
    private static int? ResolveThinkingBudget(ChatOptions options)
    {
        if (options.ReasoningBudgetTokens is > 0)
            return Math.Max(options.ReasoningBudgetTokens.Value, 1024);

        var effort = options.ReasoningEffort?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(effort) || effort is "off" or "none" or "disabled") return null;
        if (int.TryParse(effort, out var budget) && budget > 0) return Math.Max(budget, 1024);

        return effort switch
        {
            "minimal" => 1024,
            "low" => 4096,
            "medium" => 16384,
            "high" => 32768,
            "xhigh" or "max" => 64000,
            _ => 16384
        };
    }

    private object CreateMessagesRequest(List<AnthropicMessage> messages, bool stream, ChatOptions options, string? systemPrompt)
    {
        var formattedMessages = messages.Select(m =>
        {
            if (m.ContentBlocks != null && m.ContentBlocks.Count > 0)
                return new Dictionary<string, object> { ["role"] = m.Role, ["content"] = m.ContentBlocks };
            return new Dictionary<string, object> { ["role"] = m.Role, ["content"] = m.Content ?? string.Empty };
        }).ToList();

        var body = new Dictionary<string, object>
        {
            ["model"] = string.IsNullOrWhiteSpace(options.ModelId) ? _modelId : options.ModelId,
            ["messages"] = formattedMessages,
            ["max_tokens"] = options.MaxTokens ?? 2048,
            ["stream"] = stream
        };

        // system 用内容块数组承载：字符串形式挂不上 cache_control
        List<Dictionary<string, object>>? systemBlocks = null;
        if (!string.IsNullOrWhiteSpace(options.SystemPrompt))
        {
            systemBlocks = [TextBlock(options.SystemPrompt)];
            body["system"] = systemBlocks;
        }
        if (options.Temperature.HasValue) body["temperature"] = options.Temperature.Value;

        // Extended thinking（扩展思考）
        var thinkingBudget = ResolveThinkingBudget(options);
        if (thinkingBudget is > 0)
        {
            // Anthropic 要求 max_tokens 大于 thinking.budget_tokens
            var maxTokens = options.MaxTokens ?? 2048;
            body["max_tokens"] = Math.Max(maxTokens, thinkingBudget.Value + 2048);
            body["thinking"] = new { type = "enabled", budget_tokens = thinkingBudget };
            // thinking 启用时不允许同时设置 temperature
            body.Remove("temperature");
        }

        // Tools
        List<Dictionary<string, object>>? tools = null;
        if (options.Tools is { Count: > 0 })
        {
            tools = options.Tools.Select(t => new Dictionary<string, object>
            {
                ["name"] = t.Name,
                ["description"] = t.Description,
                ["input_schema"] = t.ParametersSchema
            }).ToList();
            body["tools"] = tools;
        }

        ApplyCacheBreakpoints(tools, systemBlocks, formattedMessages);
        return body;
    }

    /// <summary>
    /// 提示缓存断点。缓存前缀按 tools → system → messages 顺序累积，在这三段末尾各挂一个
    /// cache_control，Agent 逐轮只在尾部追加消息时前缀就能持续命中（否则每轮全量重算）。
    /// Anthropic 上限 4 个断点，这里用 3 个。
    /// </summary>
    private static void ApplyCacheBreakpoints(
        List<Dictionary<string, object>>? tools,
        List<Dictionary<string, object>>? systemBlocks,
        List<Dictionary<string, object>> messages)
    {
        if (tools is { Count: > 0 }) tools[^1]["cache_control"] = EphemeralCache();
        if (systemBlocks is { Count: > 0 }) systemBlocks[^1]["cache_control"] = EphemeralCache();
        if (messages.Count == 0) return;

        var last = messages[^1];
        var blocks = last["content"] as List<Dictionary<string, object>>;
        if (blocks == null)
        {
            var text = last["content"] as string ?? string.Empty;
            // 空文本块会被 Anthropic 拒绝，这种消息不挂断点
            if (text.Length == 0) return;
            blocks = [TextBlock(text)];
            last["content"] = blocks;
        }
        if (blocks.Count > 0) blocks[^1]["cache_control"] = EphemeralCache();
    }

    private static Dictionary<string, object> EphemeralCache() => new() { ["type"] = "ephemeral" };

    private HttpRequestMessage CreateRequest(string path, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body, options: JsonOptions)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
        request.Headers.Add("x-api-key", _apiKey);
        request.Headers.Add("anthropic-version", AnthropicVersion);
        return request;
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static readonly JsonSerializerOptions JsonOptionsOut = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    // --- Response models ---

    private class AnthropicMessage
    {
        public string Role { get; set; } = string.Empty;
        public string? Content { get; set; }
        [JsonIgnore]
        public List<Dictionary<string, object>>? ContentBlocks { get; set; }
    }

    private class AnthropicMessageResponse
    {
        public List<AnthropicContentBlock>? Content { get; set; }
        public AnthropicUsage? Usage { get; set; }
    }

    private class AnthropicContentBlock
    {
        public string? Type { get; set; }
        public string? Text { get; set; }
        public string? Id { get; set; }
        public string? Name { get; set; }
    }

    private class AnthropicStreamEvent
    {
        public string? Type { get; set; }
        public AnthropicStreamDelta? Delta { get; set; }
        public AnthropicContentBlock? ContentBlock { get; set; }
        /// <summary>message_start 携带的消息体（含 input_tokens 用量）</summary>
        public AnthropicStreamMessage? Message { get; set; }
        /// <summary>message_delta 携带的累计用量（output_tokens）</summary>
        public AnthropicUsage? Usage { get; set; }
    }

    private class AnthropicStreamMessage
    {
        public AnthropicUsage? Usage { get; set; }
    }

    private class AnthropicUsage
    {
        /// <summary>未命中缓存的输入 token（不含 cache_read / cache_creation）</summary>
        public int InputTokens { get; set; }
        public int OutputTokens { get; set; }
        public int CacheReadInputTokens { get; set; }
        public int CacheCreationInputTokens { get; set; }

        /// <summary>完整 Prompt 规模：三项相加才是本次请求真正送进去的输入 token</summary>
        public int FullPromptTokens => InputTokens + CacheReadInputTokens + CacheCreationInputTokens;
    }

    private class AnthropicStreamDelta
    {
        public string? Type { get; set; }
        public string? Text { get; set; }
        public string? Thinking { get; set; }
        /// <summary>thinking 块的签名增量（signature_delta），回传时必须原样带上</summary>
        public string? Signature { get; set; }
        public string? PartialJson { get; set; }
        /// <summary>message_delta 携带的停止原因（end_turn / max_tokens / tool_use…）</summary>
        public string? StopReason { get; set; }
    }
}
