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
        response.EnsureSuccessStatusCode();

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

            OpenAiStreamChunk? chunk = null;
            try
            {
                chunk = JsonSerializer.Deserialize<OpenAiStreamChunk>(data, JsonOptions);
            }
            catch
            {
                continue;
            }

            var choice = chunk?.Choices?.FirstOrDefault()?.Delta;
            var content = choice?.Content;
            var reasoning = choice?.ReasoningContent;

            if (!string.IsNullOrEmpty(reasoning))
            {
                yield return $"{{\"type\":\"thinking\",\"text\":{JsonSerializer.Serialize(reasoning)}}}";
            }
            else if (!string.IsNullOrEmpty(content))
            {
                yield return $"{{\"type\":\"content\",\"text\":{JsonSerializer.Serialize(content)}}}";
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

    private object CreateChatRequest(IReadOnlyList<LlmChatMessage> messages, bool stream, ChatOptions options)
    {
        var requestMessages = new List<object>();
        if (!string.IsNullOrWhiteSpace(options.SystemPrompt))
        {
            requestMessages.Add(new { role = "system", content = options.SystemPrompt });
        }
        foreach (var message in messages)
        {
            if (message.ContentParts != null && message.ContentParts.Count > 0)
            {
                // Multimodal: use content parts array
                var parts = new List<object>();
                foreach (var part in message.ContentParts)
                {
                    if (part.Type == "text" && part.Text != null)
                    {
                        parts.Add(new { type = "text", text = part.Text });
                    }
                    else if (part.Type == "image_url" && part.ImageUrl != null)
                    {
                        parts.Add(new { type = "image_url", image_url = new { url = part.ImageUrl } });
                    }
                }
                requestMessages.Add(new { role = message.Role, content = parts });
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

        return body;
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

    private class OpenAiChatResponse
    {
        public List<OpenAiChoice>? Choices { get; set; }
    }

    private class OpenAiChoice
    {
        public OpenAiMessage? Message { get; set; }
        public OpenAiDelta? Delta { get; set; }
    }

    private class OpenAiMessage
    {
        public string? Content { get; set; }
    }

    private class OpenAiDelta
    {
        public string? Content { get; set; }
        public string? ReasoningContent { get; set; }
    }

    private class OpenAiStreamChunk
    {
        public List<OpenAiChoice>? Choices { get; set; }
    }
}
