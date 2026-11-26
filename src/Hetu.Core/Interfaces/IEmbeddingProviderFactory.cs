namespace Hetu.Core.Interfaces;

/// <summary>Embedding Provider 工厂（与文本生成完全独立）。</summary>
public interface IEmbeddingProviderFactory
{
    Task<IEmbeddingProvider?> CreateEmbeddingProviderAsync(CancellationToken cancellationToken = default);
    Task<IEmbeddingProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default);
}