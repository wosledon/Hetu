using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Hetu.Core.Interfaces;

namespace Hetu.Infrastructure.AI;

public class OpenAiEmbeddingProvider : IEmbeddingProvider
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private readonly string _modelId;

    public int Dimensions { get; }

    public OpenAiEmbeddingProvider(HttpClient httpClient, string apiKey, string modelId, int dimensions)
    {
        _httpClient = httpClient;
        _apiKey = apiKey;
        _modelId = modelId;
        Dimensions = dimensions;
    }

    public async Task<float[]> EmbedAsync(string text, CancellationToken cancellationToken = default)
    {
        var results = await EmbedAsync([text], cancellationToken);
        return results[0];
    }

    public async Task<float[][]> EmbedAsync(IReadOnlyList<string> texts, CancellationToken cancellationToken = default)
    {
        var request = new
        {
            model = _modelId,
            input = texts.ToList(),
            encoding_format = "float"
        };

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "embeddings")
        {
            Content = JsonContent.Create(request, options: JsonOptions)
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<OpenAiEmbeddingResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Embedding response was null");

        return result.Data?
            .OrderBy(d => d.Index)
            .Select(d => d.Embedding?.ToArray() ?? [])
            .ToArray() ?? [];
    }

    private static JsonSerializerOptions JsonOptions => new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private class OpenAiEmbeddingResponse
    {
        public List<OpenAiEmbeddingData>? Data { get; set; }
    }

    private class OpenAiEmbeddingData
    {
        public int Index { get; set; }
        public List<float>? Embedding { get; set; }
    }
}
