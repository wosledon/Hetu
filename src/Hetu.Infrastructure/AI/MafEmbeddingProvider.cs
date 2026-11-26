using Hetu.Core.Interfaces;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

namespace Hetu.Infrastructure.AI;

/// <summary>官方 MEAI OpenAI Embedding 客户端包装，不再手写 /embeddings HTTP 请求。</summary>
public sealed class MafEmbeddingProvider : IEmbeddingProvider
{
    private readonly IEmbeddingGenerator<string, Embedding<float>> _generator;

    public int Dimensions { get; }

    public MafEmbeddingProvider(string apiKey, string modelId, string baseUrl, int dimensions)
    {
        Dimensions = dimensions;
        var credential = new ApiKeyCredential(string.IsNullOrWhiteSpace(apiKey) ? "local" : apiKey);
        var client = new OpenAIClient(credential, new OpenAIClientOptions
        {
            Endpoint = new Uri(baseUrl, UriKind.Absolute),
        });
        _generator = client.GetEmbeddingClient(modelId).AsIEmbeddingGenerator();
    }

    public async Task<float[]> EmbedAsync(string text, CancellationToken cancellationToken = default)
    {
        var results = await EmbedAsync([text], cancellationToken);
        return results[0];
    }

    public async Task<float[][]> EmbedAsync(IReadOnlyList<string> texts, CancellationToken cancellationToken = default)
    {
        var result = await _generator.GenerateAsync(texts, cancellationToken: cancellationToken);
        return result.Select(embedding => embedding.Vector.ToArray()).ToArray();
    }
}