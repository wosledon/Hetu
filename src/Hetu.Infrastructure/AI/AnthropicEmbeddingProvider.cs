using Hetu.Core.Interfaces;

namespace Hetu.Infrastructure.AI;

public class AnthropicEmbeddingProvider : IEmbeddingProvider
{
    public int Dimensions { get; }

    public AnthropicEmbeddingProvider(int dimensions)
    {
        Dimensions = dimensions;
    }

    public Task<float[]> EmbedAsync(string text, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("Anthropic 当前未提供公开可用的 Embedding API，请使用 OpenAI 协议的 Embedding 模型。");

    public Task<float[][]> EmbedAsync(IReadOnlyList<string> texts, CancellationToken cancellationToken = default)
        => throw new NotSupportedException("Anthropic 当前未提供公开可用的 Embedding API，请使用 OpenAI 协议的 Embedding 模型。");
}
