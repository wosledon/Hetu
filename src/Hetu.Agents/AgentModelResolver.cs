using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;

namespace Hetu.Agents;

/// <summary>解析后的 Agent 模型信息；API Key 只在内存中使用，不写日志。</summary>
public sealed record ResolvedAgentModel(AiModel Model, AiProvider Provider, string ApiKey, string BaseUrl)
{
    public string ProviderType => Provider.ProviderType.ToLowerInvariant();
}

/// <summary>按模型 Id / 默认模型解析 Provider、密钥与端点。</summary>
public sealed class AgentModelResolver
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IDataProtector _protector;
    private readonly IFoundryLocalService _foundry;

    public AgentModelResolver(
        IUnitOfWork unitOfWork,
        IDataProtectionProvider dataProtectionProvider,
        IFoundryLocalService foundry)
    {
        _unitOfWork = unitOfWork;
        _protector = dataProtectionProvider.CreateProtector("Hetu.AiProvider.ApiKey");
        _foundry = foundry;
    }

    public async Task<ResolvedAgentModel?> ResolveAsync(Guid? modelId, CancellationToken ct)
    {
        var model = modelId.HasValue
            ? await _unitOfWork.AiModels.GetByIdAsync(modelId.Value, ct)
            : await _unitOfWork.AiModels.GetDefaultByPurposeAsync("chat", ct);
        if (model == null) return null;

        var provider = await _unitOfWork.AiProviders.GetByIdAsync(model.ProviderId, ct);
        if (provider == null || !provider.IsEnabled) return null;

        var apiKey = UnprotectApiKey(provider);
        var baseUrl = await ResolveBaseUrlAsync(provider, model.ModelId, ct);
        return new ResolvedAgentModel(model, provider, apiKey, baseUrl);
    }

    public async Task<Guid?> ResolveScenarioAsync(string scenario, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(scenario)) return null;
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync($"Default{scenario}ModelId", ct);
        if (string.IsNullOrWhiteSpace(setting?.Value) || !Guid.TryParse(setting.Value, out var modelId))
            return null;
        return await ResolveAsync(modelId, ct) == null ? null : modelId;
    }

    public async Task<Guid?> ResolveCompletionAsync(CancellationToken ct)
    {
        var model = await _unitOfWork.AiModels.GetDefaultByPurposeAsync("completion", ct);
        return model == null || await ResolveAsync(model.Id, ct) == null ? null : model.Id;
    }

    private string UnprotectApiKey(AiProvider provider)
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

    private async Task<string> ResolveBaseUrlAsync(AiProvider provider, string modelId, CancellationToken ct)
    {
        var configured = string.IsNullOrWhiteSpace(provider.BaseUrl) ? null : provider.BaseUrl.Trim().TrimEnd('/');
        if (configured != null) return Normalize(provider.ProviderType, configured);

        if (!string.Equals(provider.ProviderType, "foundry", StringComparison.OrdinalIgnoreCase))
            return GetDefaultBaseUrl(provider.ProviderType);

        await _foundry.EnsureLoadedAsync(modelId, ct);
        var endpoint = await _foundry.GetEndpointAsync(ct);
        if (string.IsNullOrWhiteSpace(endpoint))
            throw new InvalidOperationException("Foundry Local 服务未运行。");
        return endpoint.TrimEnd('/');
    }

    private static string Normalize(string providerType, string baseUrl)
    {
        // Anthropic SDK 的 BaseUrl 是 API 根，不带 /v1；兼容用户在设置里填了 /v1 的旧值。
        if (string.Equals(providerType, "anthropic", StringComparison.OrdinalIgnoreCase)
            && baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase))
            return baseUrl[..^3];
        return baseUrl;
    }

    private static string GetDefaultBaseUrl(string providerType)
        => providerType.ToLowerInvariant() switch
        {
            "anthropic" => "https://api.anthropic.com",
            _ => "https://api.openai.com/v1",
        };
}