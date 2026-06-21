using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Hetu.Core.Interfaces;

namespace Hetu.Infrastructure.AI;

public class OpenAiLlmProvider : ILLMProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private readonly string _modelId;

    public string ProviderType => "openai";
    public bool SupportsStreaming => true;

    public OpenAiLlmProvider(HttpClient httpClient, string apiKey, string modelId)
    {
        _httpClient = httpClient;
        _apiKey = apiKey;
        _modelId = modelId;
    }

    public async Task<string> ChatAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default)
    {
        var requestBody = CreateChatRequest(messages, false, options);
        using var request = CreateRequest("chat/completions", requestBody);
        var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException($"OpenAI API returned {(int)response.StatusCode}: {errorBody}");
        }

        var result = await response.Content.ReadFromJsonAsync<OpenAiChatResponse>(cancellationToken: cancellationToken);
        return result?.Choices?.FirstOrDefault()?.Message?.Content ?? string.Empty;
    }

    public async IAsyncEnumerable<string> ChatStreamAsync(
        IReadOnlyList<LlmChatMessage> messages,
        ChatOptions options,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var requestBody = CreateChatRequest(messages, true, options);
        using var request = CreateRequest("chat/completions", requestBody);
        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException($"OpenAI stream API returned {(int)response.StatusCode}: {errorBody}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        // Accumulate tool calls across stream chunks
        var toolCallAccumulators = new Dictionary<int, (string Id, string Name, StringBuilder Args)>();

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line == null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (!line.StartsWith("data: ")) continue;

            var data = line[6..];
            if (data == "[DONE]") break;

            OpenAiStreamChunk? chunk = null;
            try
            {
                chunk = JsonSerializer.Deserialize<OpenAiStreamChunk>(data, JsonOptions);
            }
            catch
            {
                continue;
            }

            var choice = chunk?.Choices?.FirstOrDefault();
            var delta = choice?.Delta;

            // Content / thinking
            var content = delta?.Content;
            var reasoning = delta?.ReasoningContent;

            if (!string.IsNullOrEmpty(reasoning))
            {
                yield return $"{{\"type\":\"thinking\",\"text\":{JsonSerializer.Serialize(reasoning)}}}";
            }
            else if (!string.IsNullOrEmpty(content))
            {
                yield return $"{{\"type\":\"content\",\"text\":{JsonSerializer.Serialize(content)}}}";
            }

            // Tool calls accumulation
            if (delta?.ToolCalls != null)
            {
                foreach (var tc in delta.ToolCalls)
                {
                    var idx = tc.Index;
                    if (!toolCallAccumulators.ContainsKey(idx))
                    {
                        toolCallAccumulators[idx] = (tc.Id ?? "", tc.Function?.Name ?? "", new StringBuilder());
                    }
                    else
                    {
                        // Update id/name if they arrive in subsequent chunks
                        if (!string.IsNullOrEmpty(tc.Id))
                            toolCallAccumulators[idx] = (tc.Id, toolCallAccumulators[idx].Name, toolCallAccumulators[idx].Args);
                        if (!string.IsNullOrEmpty(tc.Function?.Name))
                            toolCallAccumulators[idx] = (toolCallAccumulators[idx].Id, tc.Function.Name, toolCallAccumulators[idx].Args);
                    }
                    if (!string.IsNullOrEmpty(tc.Function?.Arguments))
                        toolCallAccumulators[idx].Args.Append(tc.Function.Arguments);
                }
            }

            // Check finish reason — handle any completion state
            var finishReason = choice?.FinishReason;
            if (finishReason != null)
            {
                if (toolCallAccumulators.Count > 0)
                {
                    var toolCalls = toolCallAccumulators.Values.Select((tc, i) => new LlmToolCall
                    {
                        Id = string.IsNullOrEmpty(tc.Id) ? $"call_{i}_{Guid.NewGuid():N}" : tc.Id,
                        Name = tc.Name,
                        Arguments = tc.Args.ToString()
                    }).ToList();

                    yield return JsonSerializer.Serialize(new { type = "tool_calls", toolCalls }, JsonOptionsOut);
                }
                yield break;
            }
        }

        // Stream ended without explicit finish_reason — emit any accumulated tool calls
        if (toolCallAccumulators.Count > 0)
        {
            var toolCalls = toolCallAccumulators.Values.Select((tc, i) => new LlmToolCall
            {
                Id = string.IsNullOrEmpty(tc.Id) ? $"call_{i}_{Guid.NewGuid():N}" : tc.Id,
                Name = tc.Name,
                Arguments = tc.Args.ToString()
            }).ToList();

            yield return JsonSerializer.Serialize(new { type = "tool_calls", toolCalls }, JsonOptionsOut);
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

    private object CreateChatRequest(IReadOnlyList<LlmChatMessage> messages, bool stream, ChatOptions options)
    {
        var requestMessages = new List<object>();
        if (!string.IsNullOrWhiteSpace(options.SystemPrompt))
        {
            requestMessages.Add(new { role = "system", content = options.SystemPrompt });
        }
        foreach (var message in messages)
        {
            // tool role message: send tool_call_id + content
            if (message.Role == "tool")
            {
                requestMessages.Add(new
                {
                    role = "tool",
                    tool_call_id = message.ToolCallId ?? "",
                    content = message.Content
                });
                continue;
            }

            // assistant message with tool_calls
            if (message.Role == "assistant" && message.ToolCalls is { Count: > 0 })
            {
                var toolCalls = message.ToolCalls.Select(tc => new
                {
                    id = tc.Id,
                    type = "function",
                    function = new { name = tc.Name, arguments = tc.Arguments }
                }).ToList();

                if (message.ContentParts != null && message.ContentParts.Count > 0)
                {
                    requestMessages.Add(new { role = "assistant", content = (object?)BuildContentParts(message.ContentParts), tool_calls = toolCalls });
                }
                else
                {
                    requestMessages.Add(new { role = "assistant", content = (object?)(string.IsNullOrWhiteSpace(message.Content) ? null : message.Content), tool_calls = toolCalls });
                }
                continue;
            }

            // Normal user/assistant messages
            if (message.ContentParts != null && message.ContentParts.Count > 0)
            {
                requestMessages.Add(new { role = message.Role, content = (object)BuildContentParts(message.ContentParts) });
            }
            else
            {
                requestMessages.Add(new { role = message.Role, content = message.Content });
            }
        }

        var body = new Dictionary<string, object>
        {
            ["model"] = string.IsNullOrWhiteSpace(options.ModelId) ? _modelId : options.ModelId,
            ["messages"] = requestMessages,
            ["stream"] = stream
        };

        if (options.Temperature.HasValue) body["temperature"] = options.Temperature.Value;
        if (options.MaxTokens.HasValue) body["max_tokens"] = options.MaxTokens.Value;
        if (!string.IsNullOrWhiteSpace(options.ReasoningEffort)) body["reasoning_effort"] = options.ReasoningEffort;

        // Tools
        if (options.Tools is { Count: > 0 })
        {
            body["tools"] = options.Tools.Select(t => new
            {
                type = "function",
                function = new
                {
                    name = t.Name,
                    description = t.Description,
                    parameters = t.ParametersSchema
                }
            }).ToList();

            body["tool_choice"] = options.ToolChoice ?? "auto";
        }

        return body;
    }

    private static List<object> BuildContentParts(List<LlmContentPart> parts)
    {
        var result = new List<object>();
        foreach (var part in parts)
        {
            if (part.Type == "text" && part.Text != null)
                result.Add(new { type = "text", text = part.Text });
            else if (part.Type == "image_url" && part.ImageUrl != null)
                result.Add(new { type = "image_url", image_url = new { url = part.ImageUrl } });
        }
        return result;
    }

    private HttpRequestMessage CreateRequest(string path, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body, options: JsonOptions)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
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

    private class OpenAiChatResponse
    {
        public List<OpenAiChoice>? Choices { get; set; }
    }

    private class OpenAiChoice
    {
        public OpenAiMessage? Message { get; set; }
        public OpenAiDelta? Delta { get; set; }
        public string? FinishReason { get; set; }
    }

    private class OpenAiMessage
    {
        public string? Content { get; set; }
        public List<OpenAiToolCall>? ToolCalls { get; set; }
    }

    private class OpenAiDelta
    {
        public string? Content { get; set; }
        public string? ReasoningContent { get; set; }
        public List<OpenAiToolCallDelta>? ToolCalls { get; set; }
    }

    private class OpenAiToolCall
    {
        public string? Id { get; set; }
        public string? Type { get; set; }
        public OpenAiFunctionCall? Function { get; set; }
    }

    private class OpenAiToolCallDelta
    {
        public int Index { get; set; }
        public string? Id { get; set; }
        public OpenAiFunctionCall? Function { get; set; }
    }

    private class OpenAiFunctionCall
    {
        public string? Name { get; set; }
        public string? Arguments { get; set; }
    }

    private class OpenAiStreamChunk
    {
        public List<OpenAiChoice>? Choices { get; set; }
    }
}
