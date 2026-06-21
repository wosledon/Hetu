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
    {
        var (systemPrompt, requestMessages) = BuildMessages(messages);
        var requestBody = CreateMessagesRequest(requestMessages, false, options, systemPrompt);
        using var request = CreateRequest("messages", requestBody);
        var response = await _httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<AnthropicMessageResponse>(cancellationToken: cancellationToken);
        return result?.Content?.FirstOrDefault(c => c.Type == "text")?.Text ?? string.Empty;
    }

    public async IAsyncEnumerable<string> ChatStreamAsync(
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var (systemPrompt, requestMessages) = BuildMessages(messages);
        var requestBody = CreateMessagesRequest(requestMessages, true, options, systemPrompt);
        using var request = CreateRequest("messages", requestBody);
        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        // Track tool use blocks across stream events
        var currentToolUseId = "";
        var currentToolName = "";
        var currentToolArgs = new StringBuilder();
        var hasToolUse = false;

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
                        break;
                    }

                case "content_block_delta":
                    {
                        var delta = evt.Delta;
                        if (delta?.Type == "thinking_delta" && !string.IsNullOrEmpty(delta.Thinking))
                        {
                            yield return $"{{\"type\":\"thinking\",\"text\":{JsonSerializer.Serialize(delta.Thinking)}}}";
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

                case "message_stop":
                    {
                        yield break;
                    }
            }
        }
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
                    ContentBlocks = new List<object>
                    {
                        new
                        {
                            type = "tool_result",
                            tool_use_id = msg.ToolCallId ?? "",
                            content = msg.Content
                        }
                    }
                });
                continue;
            }

            if (msg.Role == "assistant" && msg.ToolCalls is { Count: > 0 })
            {
                // Assistant with tool_use content blocks
                var blocks = new List<object>();
                if (!string.IsNullOrWhiteSpace(msg.Content))
                    blocks.Add(new { type = "text", text = msg.Content });
                foreach (var tc in msg.ToolCalls)
                {
                    // Parse arguments as JsonElement for Anthropic's input field
                    JsonElement inputEl;
                    try { inputEl = JsonSerializer.Deserialize<JsonElement>(tc.Arguments); }
                    catch { inputEl = JsonSerializer.Deserialize<JsonElement>("{}"); }
                    blocks.Add(new { type = "tool_use", id = tc.Id, name = tc.Name, input = inputEl });
                }
                result.Add(new AnthropicMessage { Role = "assistant", ContentBlocks = blocks });
                continue;
            }

            // Normal user/assistant messages
            if (msg.ContentParts != null && msg.ContentParts.Count > 0)
            {
                var blocks = new List<object>();
                foreach (var part in msg.ContentParts)
                {
                    if (part.Type == "text" && part.Text != null)
                        blocks.Add(new { type = "text", text = part.Text });
                    else if (part.Type == "image_url" && part.ImageUrl != null)
                        blocks.Add(new
                        {
                            type = "image",
                            source = new
                            {
                                type = "base64",
                                media_type = part.MediaType ?? "image/png",
                                data = part.ImageUrl
                            }
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

    private object CreateMessagesRequest(List<AnthropicMessage> messages, bool stream, ChatOptions options, string? systemPrompt)
    {
        var formattedMessages = messages.Select(m =>
        {
            if (m.ContentBlocks != null && m.ContentBlocks.Count > 0)
                return new { role = m.Role, content = (object)m.ContentBlocks };
            return new { role = m.Role, content = (object)(m.Content ?? string.Empty) };
        }).ToList();

        var body = new Dictionary<string, object>
        {
            ["model"] = string.IsNullOrWhiteSpace(options.ModelId) ? _modelId : options.ModelId,
            ["messages"] = formattedMessages,
            ["max_tokens"] = options.MaxTokens ?? 2048,
            ["stream"] = stream
        };

        // System prompt from ChatOptions
        if (!string.IsNullOrWhiteSpace(options.SystemPrompt))
            body["system"] = options.SystemPrompt;
        if (options.Temperature.HasValue) body["temperature"] = options.Temperature.Value;

        // Extended thinking
        if (!string.IsNullOrWhiteSpace(options.ReasoningEffort))
        {
            var budget = options.ReasoningEffort switch
            {
                "low" => 2048,
                "high" => 32768,
                _ => 8192
            };
            body["thinking"] = new { type = "enabled", budget_tokens = budget };
            if (!stream) body["stream"] = true;
        }

        // Tools
        if (options.Tools is { Count: > 0 })
        {
            body["tools"] = options.Tools.Select(t => new
            {
                name = t.Name,
                description = t.Description,
                input_schema = t.ParametersSchema
            }).ToList();
        }

        return body;
    }

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

    private static JsonSerializerOptions JsonOptions => new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static JsonSerializerOptions JsonOptionsOut => new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    // --- Response models ---

    private class AnthropicMessage
    {
        public string Role { get; set; } = string.Empty;
        public string? Content { get; set; }
        [JsonIgnore]
        public List<object>? ContentBlocks { get; set; }
    }

    private class AnthropicMessageResponse
    {
        public List<AnthropicContentBlock>? Content { get; set; }
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
    }

    private class AnthropicStreamDelta
    {
        public string? Type { get; set; }
        public string? Text { get; set; }
        public string? Thinking { get; set; }
        public string? PartialJson { get; set; }
    }
}
