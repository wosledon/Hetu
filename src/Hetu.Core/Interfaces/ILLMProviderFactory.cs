namespace Hetu.Core.Interfaces;

public interface ILLMProviderFactory
{
    Task<ILLMProvider?> CreateChatProviderAsync(CancellationToken cancellationToken = default);
    Task<ILLMProvider?> CreateCompletionProviderAsync(CancellationToken cancellationToken = default);
    Task<ILLMProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default);
}

public interface IEmbeddingProviderFactory
{
    Task<IEmbeddingProvider?> CreateEmbeddingProviderAsync(CancellationToken cancellationToken = default);
    Task<IEmbeddingProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default);
}
