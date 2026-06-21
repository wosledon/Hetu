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
        var (systemPrompt, requestMessages) = BuildMessages(messages, options.SystemPrompt);
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
        var (systemPrompt, requestMessages) = BuildMessages(messages, options.SystemPrompt);
        var requestBody = CreateMessagesRequest(requestMessages, true, options, systemPrompt);
        using var request = CreateRequest("messages", requestBody);
        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line == null) yield break;
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (!line.StartsWith("data: ")) continue;

            var data = line[6..];
            if (data == "[DONE]") yield break;

            AnthropicStreamEvent? evt = null;
            try
            {
                evt = JsonSerializer.Deserialize<AnthropicStreamEvent>(data, JsonOptions);
            }
            catch
            {
                continue;
            }

            var delta = evt?.Delta;
            if (delta?.Type == "thinking_delta" && !string.IsNullOrEmpty(delta.Thinking))
            {
                yield return $"{{\"type\":\"thinking\",\"text\":{JsonSerializer.Serialize(delta.Thinking)}}}";
            }
            else if (!string.IsNullOrEmpty(delta?.Text))
            {
                yield return $"{{\"type\":\"content\",\"text\":{JsonSerializer.Serialize(delta.Text)}}}";
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

    private static (string? SystemPrompt, List<AnthropicMessage> Messages) BuildMessages(IReadOnlyList<LlmChatMessage> messages, string? systemPrompt)
    {
        var requestMessages = messages
            .Where(m => m.Role is "user" or "assistant")
            .Select(m =>
            {
                if (m.ContentParts != null && m.ContentParts.Count > 0)
                {
                    // Multimodal: use content blocks array
                    var contentBlocks = new List<object>();
                    foreach (var part in m.ContentParts)
                    {
                        if (part.Type == "text" && part.Text != null)
                        {
                            contentBlocks.Add(new { type = "text", text = part.Text });
                        }
                        else if (part.Type == "image_url" && part.ImageUrl != null)
                        {
                            // Anthropic uses base64 image source format
                            contentBlocks.Add(new
                            {
                                type = "image",
                                source = new
                                {
                                    type = "base64",
                                    media_type = part.MediaType ?? "image/png",
                                    data = part.ImageUrl // base64 data without data: prefix
                                }
                            });
                        }
                    }
                    return new AnthropicMessage { Role = m.Role, ContentBlocks = contentBlocks };
                }
                return new AnthropicMessage { Role = m.Role, Content = m.Content };
            })
            .ToList();

        return (systemPrompt, requestMessages);
    }

    private object CreateMessagesRequest(List<AnthropicMessage> messages, bool stream, ChatOptions options, string? systemPrompt)
    {
        // Convert messages to the correct serialization format
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

        if (!string.IsNullOrWhiteSpace(systemPrompt)) body["system"] = systemPrompt;
        if (options.Temperature.HasValue) body["temperature"] = options.Temperature.Value;

        // Extended thinking: map reasoning effort to budget_tokens
        if (!string.IsNullOrWhiteSpace(options.ReasoningEffort))
        {
            var budget = options.ReasoningEffort switch
            {
                "low" => 2048,
                "high" => 32768,
                _ => 8192 // medium
            };
            body["thinking"] = new { type = "enabled", budget_tokens = budget };
            // thinking requires streaming
            if (!stream) body["stream"] = true;
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

    private class AnthropicMessage
    {
        public string Role { get; set; } = string.Empty;
        public string? Content { get; set; }
        [System.Text.Json.Serialization.JsonIgnore]
        public List<object>? ContentBlocks { get; set; }
        // When ContentBlocks is set, use it as "content" (array); otherwise use Content (string)
        // This is handled by a custom converter or by using the right property at serialization
    }

    private class AnthropicMessageResponse
    {
        public List<AnthropicContentBlock>? Content { get; set; }
    }

    private class AnthropicContentBlock
    {
        public string? Type { get; set; }
        public string? Text { get; set; }
    }

    private class AnthropicStreamEvent
    {
        public string? Type { get; set; }
        public AnthropicStreamDelta? Delta { get; set; }
    }

    private class AnthropicStreamDelta
    {
        public string? Type { get; set; }
        public string? Text { get; set; }
        public string? Thinking { get; set; }
    }
}
