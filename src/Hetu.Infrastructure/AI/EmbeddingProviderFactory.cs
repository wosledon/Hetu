using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.AI;

public class EmbeddingProviderFactory : IEmbeddingProviderFactory
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IDataProtector _protector;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<EmbeddingProviderFactory> _logger;

    public EmbeddingProviderFactory(
        IUnitOfWork unitOfWork,
        IDataProtectionProvider dataProtectionProvider,
        IHttpClientFactory httpClientFactory,
        ILogger<EmbeddingProviderFactory> logger)
    {
        _unitOfWork = unitOfWork;
        _protector = dataProtectionProvider.CreateProtector("Hetu.AiProvider.ApiKey");
        _httpClientFactory = httpClientFactory;
        _logger = logger;
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

    /// <summary>
    /// 构造 Embedding 提供方；配置不可用（API Key 解不开 / Provider 类型不支持）时返回 null 并留日志，
    /// 不抛异常——调用方一律把 null 当作「没有可用的 Embedding」，否则状态页、搜索、索引任务
    /// 会因为一个密钥问题直接 500。
    /// </summary>
    private IEmbeddingProvider? CreateProvider(Core.Entities.AiProvider provider, string modelId, int dimensions)
    {
        string apiKey;
        try
        {
            apiKey = _protector.Unprotect(provider.EncryptedApiKey);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Embedding 提供方 {Provider}（{Type}）的 API Key 无法解密，本次视为未配置；" +
                "请在「设置 → 大模型」重新保存该模型的 API Key",
                provider.Name, provider.ProviderType);
            return null;
        }

        var httpClient = _httpClientFactory.CreateClient();
        httpClient.BaseAddress = new Uri(string.IsNullOrWhiteSpace(provider.BaseUrl)
            ? GetDefaultBaseUrl(provider.ProviderType)
            : provider.BaseUrl.TrimEnd('/') + "/");

        switch (provider.ProviderType.ToLowerInvariant())
        {
            case "openai":
                return new OpenAiEmbeddingProvider(httpClient, apiKey, modelId, dimensions);
            case "anthropic":
                return new AnthropicEmbeddingProvider(dimensions);
            default:
                _logger.LogWarning("不支持的 Embedding Provider 类型：{Type}（提供方 {Provider}）", provider.ProviderType, provider.Name);
                return null;
        }
    }

    private static string GetDefaultBaseUrl(string providerType)
        => providerType.ToLowerInvariant() switch
        {
            "anthropic" => "https://api.anthropic.com/v1/",
            _ => "https://api.openai.com/v1/"
        };
}
