namespace Hetu.Core.Interfaces;

public interface ILLMProviderFactory
{
    Task<ILLMProvider?> CreateChatProviderAsync(CancellationToken cancellationToken = default);
    Task<ILLMProvider?> CreateCompletionProviderAsync(CancellationToken cancellationToken = default);
    Task<ILLMProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 按「请求指定的模型 → 会话/话题绑定模型 → 默认对话模型」的优先级解析 Provider。
    /// </summary>
    /// <param name="requestedModelId">请求中携带的模型 Id（字符串形式，可空）</param>
    /// <param name="fallbackModelId">会话/话题绑定的模型 Id</param>
    /// <returns>解析出的 Provider 及其模型 Id；回退到默认模型时模型 Id 为 null</returns>
    Task<(ILLMProvider? Provider, Guid? ModelId)> ResolveAsync(
        string? requestedModelId,
        Guid? fallbackModelId = null,
        CancellationToken cancellationToken = default);
}

public interface IEmbeddingProviderFactory
{
    Task<IEmbeddingProvider?> CreateEmbeddingProviderAsync(CancellationToken cancellationToken = default);
    Task<IEmbeddingProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default);
}
