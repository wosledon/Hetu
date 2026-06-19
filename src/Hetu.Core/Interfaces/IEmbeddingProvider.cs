namespace Hetu.Core.Interfaces;

public interface IEmbeddingProvider
{
    int Dimensions { get; }
    Task<float[]> EmbedAsync(string text, CancellationToken cancellationToken = default);
    Task<float[][]> EmbedAsync(IReadOnlyList<string> texts, CancellationToken cancellationToken = default);
}
