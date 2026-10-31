using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.AI;

public class EmbeddingProviderFactory : IEmbeddingProviderFactory
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IDataProtector _protector;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IFoundryLocalService _foundry;
    private readonly ILocalizer _localizer;
    private readonly ILogger<EmbeddingProviderFactory> _logger;

    public EmbeddingProviderFactory(
        IUnitOfWork unitOfWork,
        IDataProtectionProvider dataProtectionProvider,
        IHttpClientFactory httpClientFactory,
        IFoundryLocalService foundry,
        ILocalizer localizer,
        ILogger<EmbeddingProviderFactory> logger)
    {
        _unitOfWork = unitOfWork;
        _protector = dataProtectionProvider.CreateProtector("Hetu.AiProvider.ApiKey");
        _httpClientFactory = httpClientFactory;
        _foundry = foundry;
        _localizer = localizer;
        _logger = logger;
    }

    public async Task<IEmbeddingProvider?> CreateEmbeddingProviderAsync(CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetDefaultByPurposeAsync("embedding", cancellationToken);
        if (model == null) return null;

        var provider = await _unitOfWork.AiProviders.GetByIdAsync(model.ProviderId, cancellationToken);
        if (provider == null || !provider.IsEnabled) return null;

        var dimensions = model.Dimensions ?? 1536;
        return await CreateProviderAsync(provider, model.ModelId, dimensions, cancellationToken);
    }

    public async Task<IEmbeddingProvider?> CreateProviderAsync(Guid modelId, CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetByIdAsync(modelId, cancellationToken);
        if (model == null) return null;

        var provider = await _unitOfWork.AiProviders.GetByIdAsync(model.ProviderId, cancellationToken);
        if (provider == null || !provider.IsEnabled) return null;

        var dimensions = model.Dimensions ?? 1536;
        return await CreateProviderAsync(provider, model.ModelId, dimensions, cancellationToken);
    }

    /// <summary>
    /// 构造 Embedding 提供方；配置不可用（API Key 解不开 / Provider 类型不支持）时返回 null 并留日志，
    /// 不抛异常——调用方一律把 null 当作「没有可用的 Embedding」，否则状态页、搜索、索引任务
    /// 会因为一个密钥问题直接 500。
    /// </summary>
    private async Task<IEmbeddingProvider?> CreateProviderAsync(
        Core.Entities.AiProvider provider, string modelId, int dimensions, CancellationToken cancellationToken)
    {
        string apiKey;
        try
        {
            // 本地服务商（Foundry Local）没有 Key，库里存的是空串，不能送进 Unprotect
            apiKey = string.IsNullOrEmpty(provider.EncryptedApiKey)
                ? string.Empty
                : _protector.Unprotect(provider.EncryptedApiKey);
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
        httpClient.BaseAddress = new Uri(await ResolveBaseUrlAsync(provider, cancellationToken));

        switch (provider.ProviderType.ToLowerInvariant())
        {
            case "openai":
            // Foundry Local 暴露 OpenAI 兼容端点，直接复用
            case "foundry":
                return new OpenAiEmbeddingProvider(httpClient, apiKey, modelId, dimensions);
            case "anthropic":
                return new AnthropicEmbeddingProvider(dimensions);
            default:
                _logger.LogWarning("不支持的 Embedding Provider 类型：{Type}（提供方 {Provider}）", provider.ProviderType, provider.Name);
                return null;
        }
    }

    /// <summary>
    /// 解析 BaseUrl。Foundry Local 的端口由运行时动态分配，写死必然过期，
    /// 所以这类服务商没配 BaseUrl 时现场问运行时拿当前端点；用户手填了（跨机器指向）则尊重填写值。
    /// </summary>
    private async Task<string> ResolveBaseUrlAsync(Core.Entities.AiProvider provider, CancellationToken cancellationToken)
    {
        var configured = string.IsNullOrWhiteSpace(provider.BaseUrl)
            ? null
            : provider.BaseUrl.TrimEnd('/') + "/";
        if (configured != null) return configured;

        if (!string.Equals(provider.ProviderType, "foundry", StringComparison.OrdinalIgnoreCase))
            return GetDefaultBaseUrl(provider.ProviderType);

        var endpoint = await _foundry.GetEndpointAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(endpoint))
            throw new InvalidOperationException(_localizer.T("foundry.serviceNotRunning"));

        return endpoint.TrimEnd('/') + "/";
    }

    private static string GetDefaultBaseUrl(string providerType)
        => providerType.ToLowerInvariant() switch
        {
            "anthropic" => "https://api.anthropic.com/v1/",
            _ => "https://api.openai.com/v1/"
        };
}
