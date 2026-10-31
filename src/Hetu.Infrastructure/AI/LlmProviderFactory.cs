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

    /// <summary>场景默认模型（设置键 Default{scenario}ModelId）；未配置或不可用返回 null</summary>
    public async Task<ILLMProvider?> CreateScenarioProviderAsync(string scenario, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(scenario)) return null;
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync($"Default{scenario}ModelId", cancellationToken);
        if (string.IsNullOrWhiteSpace(setting?.Value) || !Guid.TryParse(setting.Value, out var modelId)) return null;
        return await CreateProviderAsync(modelId, cancellationToken);
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
        var apiKey = UnprotectApiKey(provider);

        var httpClient = _httpClientFactory.CreateClient();
        httpClient.BaseAddress = new Uri(ResolveBaseUrl(provider));

        return provider.ProviderType.ToLowerInvariant() switch
        {
            "openai" => new OpenAiLlmProvider(httpClient, apiKey, modelId),
            "anthropic" => new AnthropicLlmProvider(httpClient, apiKey, modelId),
            // Foundry Local 暴露的是 OpenAI 兼容端点，直接复用；本地运行时没有 API Key
            "foundry" => new OpenAiLlmProvider(httpClient, apiKey, modelId),
            _ => throw new NotSupportedException($"不支持的 Provider 类型: {provider.ProviderType}")
        };
    }

    /// <summary>本地运行时（Foundry Local）没有固定端口，BaseUrl 由用户按当前端点填；没填时用默认端口</summary>
    private static string ResolveBaseUrl(Core.Entities.AiProvider provider)
    {
        var configured = string.IsNullOrWhiteSpace(provider.BaseUrl)
            ? null
            : provider.BaseUrl.TrimEnd('/') + "/";
        if (configured != null) return configured;

        return string.Equals(provider.ProviderType, "foundry", StringComparison.OrdinalIgnoreCase)
            ? "http://127.0.0.1:5272/v1/"
            : GetDefaultBaseUrl(provider.ProviderType);
    }

    /// <summary>
    /// API Key 用 DataProtection 加密存储：跨设备/旧版本/不同判别值加密的值无法解密，
    /// 此时给出可操作的提示，避免把 CryptographicException 直接抛成 500。
    /// 本地服务商（Foundry Local）没有 Key，库里存的是空串，不能送进 Unprotect。
    /// </summary>
    private string UnprotectApiKey(Core.Entities.AiProvider provider)
    {
        if (string.IsNullOrEmpty(provider.EncryptedApiKey)) return string.Empty;
        try
        {
            return _protector.Unprotect(provider.EncryptedApiKey);
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or FormatException)
        {
            throw new InvalidOperationException(
                $"服务商「{provider.Name}」的 API Key 解密失败（可能由其他设备或旧版本写入），请在设置中重新填写该服务商的 API Key。",
                ex);
        }
    }

    private static string GetDefaultBaseUrl(string providerType)
        => providerType.ToLowerInvariant() switch
        {
            "anthropic" => "https://api.anthropic.com/v1/",
            _ => "https://api.openai.com/v1/"
        };
}
