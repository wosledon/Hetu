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

    public async Task<(ILLMProvider? Provider, Guid? ModelId)> ResolveAsync(
        string? requestedModelId,
        Guid? fallbackModelId = null,
        CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrWhiteSpace(requestedModelId) && Guid.TryParse(requestedModelId, out var requestedId))
            return (await CreateProviderAsync(requestedId, cancellationToken), requestedId);

        if (fallbackModelId.HasValue)
            return (await CreateProviderAsync(fallbackModelId.Value, cancellationToken), fallbackModelId);

        return (await CreateChatProviderAsync(cancellationToken), null);
    }

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
        // API Key 用 DataProtection 加密存储：跨设备/旧版本/不同判别值加密的值无法解密，
        // 此时给出可操作的提示，避免把 CryptographicException 直接抛成 500
        string apiKey;
        try
        {
            apiKey = _protector.Unprotect(provider.EncryptedApiKey);
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or FormatException)
        {
            throw new InvalidOperationException(
                $"服务商「{provider.Name}」的 API Key 解密失败（可能由其他设备或旧版本写入），请在设置中重新填写该服务商的 API Key。",
                ex);
        }
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
