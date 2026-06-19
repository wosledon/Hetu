using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;

namespace Hetu.Infrastructure.AI;

public class LlmProviderFactory : ILLMProviderFactory
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IDataProtector _protector;
    private readonly IHttpClientFactory _httpClientFactory;

    public LlmProviderFactory(IUnitOfWork unitOfWork, IDataProtectionProvider dataProtectionProvider, IHttpClientFactory httpClientFactory)
    {
        _unitOfWork = unitOfWork;
        _protector = dataProtectionProvider.CreateProtector("Hetu.AiProvider.ApiKey");
        _httpClientFactory = httpClientFactory;
    }

    public Task<ILLMProvider?> CreateChatProviderAsync(CancellationToken cancellationToken = default)
        => CreateProviderByPurposeAsync("chat", cancellationToken);

    public Task<ILLMProvider?> CreateCompletionProviderAsync(CancellationToken cancellationToken = default)
        => CreateProviderByPurposeAsync("completion", cancellationToken);

    public async Task<ILLMProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetByIdAsync(modelId, cancellationToken);
        if (model == null) return null;
        return await CreateProviderAsync(model, cancellationToken);
    }

    private async Task<ILLMProvider?> CreateProviderByPurposeAsync(string purpose, CancellationToken cancellationToken)
    {
        var model = await _unitOfWork.AiModels.GetDefaultByPurposeAsync(purpose, cancellationToken);
        if (model == null) return null;
        return await CreateProviderAsync(model, cancellationToken);
    }

    private async Task<ILLMProvider?> CreateProviderAsync(Core.Entities.AiModel model, CancellationToken cancellationToken)
    {
        var provider = await _unitOfWork.AiProviders.GetByIdAsync(model.ProviderId, cancellationToken);
        if (provider == null || !provider.IsEnabled) return null;
        return CreateProvider(provider, model.ModelId);
    }

    private ILLMProvider CreateProvider(Core.Entities.AiProvider provider, string modelId)
    {
        var apiKey = _protector.Unprotect(provider.EncryptedApiKey);
        var httpClient = _httpClientFactory.CreateClient();
        httpClient.BaseAddress = new Uri(string.IsNullOrWhiteSpace(provider.BaseUrl)
            ? GetDefaultBaseUrl(provider.ProviderType)
            : provider.BaseUrl.TrimEnd('/') + "/");

        return provider.ProviderType.ToLowerInvariant() switch
        {
            "openai" => new OpenAiLlmProvider(httpClient, apiKey, modelId),
            "anthropic" => new AnthropicLlmProvider(httpClient, apiKey, modelId),
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
