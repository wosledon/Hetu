using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;

namespace Hetu.Infrastructure.AI;

public class EmbeddingProviderFactory : IEmbeddingProviderFactory
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IDataProtector _protector;
    private readonly IHttpClientFactory _httpClientFactory;

    public EmbeddingProviderFactory(IUnitOfWork unitOfWork, IDataProtectionProvider dataProtectionProvider, IHttpClientFactory httpClientFactory)
    {
        _unitOfWork = unitOfWork;
        _protector = dataProtectionProvider.CreateProtector("Hetu.AiProvider.ApiKey");
        _httpClientFactory = httpClientFactory;
    }

    public async Task<IEmbeddingProvider?> CreateEmbeddingProviderAsync(CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetDefaultByPurposeAsync("embedding", cancellationToken);
        if (model == null) return null;

        var provider = await _unitOfWork.AiProviders.GetByIdAsync(model.ProviderId, cancellationToken);
        if (provider == null || !provider.IsEnabled) return null;

        var dimensions = model.Dimensions ?? 1536;
        return CreateProvider(provider, model.ModelId, dimensions);
    }

    public async Task<IEmbeddingProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetByIdAsync(modelId, cancellationToken);
        if (model == null) return null;

        var provider = await _unitOfWork.AiProviders.GetByIdAsync(model.ProviderId, cancellationToken);
        if (provider == null || !provider.IsEnabled) return null;

        var dimensions = model.Dimensions ?? 1536;
        return CreateProvider(provider, model.ModelId, dimensions);
    }

    private IEmbeddingProvider CreateProvider(Core.Entities.AiProvider provider, string modelId, int dimensions)
    {
        var apiKey = _protector.Unprotect(provider.EncryptedApiKey);
        var httpClient = _httpClientFactory.CreateClient();
        httpClient.BaseAddress = new Uri(string.IsNullOrWhiteSpace(provider.BaseUrl)
            ? GetDefaultBaseUrl(provider.ProviderType)
            : provider.BaseUrl.TrimEnd('/') + "/");

        return provider.ProviderType.ToLowerInvariant() switch
        {
            "openai" => new OpenAiEmbeddingProvider(httpClient, apiKey, modelId, dimensions),
            "anthropic" => new AnthropicEmbeddingProvider(dimensions),
            _ => throw new NotSupportedException($"不支持的 Provider 类型: {provider.ProviderType}")
        };
    }

    private static string GetDefaultBaseUrl(string providerType)
        => providerType.ToLowerInvariant() switch
        {
            "anthropic" => "https://api.anthropic.com/v1/",
            _ => "https://api.openai.com/v1/"
        };
}
