using System.Net.Http.Json;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.DataProtection;

namespace Hetu.Core.Services;

public class AiProviderService : IAiProviderService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IDataProtector _protector;
    private readonly IHttpClientFactory _httpClientFactory;

    public AiProviderService(IUnitOfWork unitOfWork, IDataProtectionProvider dataProtectionProvider, IHttpClientFactory httpClientFactory)
    {
        _unitOfWork = unitOfWork;
        _protector = dataProtectionProvider.CreateProtector("Hetu.AiProvider.ApiKey");
        _httpClientFactory = httpClientFactory;
    }

    public async Task<ApiResponse<List<AiProviderDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var providers = await _unitOfWork.AiProviders.GetAllWithModelsAsync(cancellationToken);
        return ApiResponse<List<AiProviderDto>>.Ok(providers.Select(Map).ToList());
    }

    public async Task<ApiResponse<AiProviderDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var provider = await _unitOfWork.AiProviders.GetByIdWithModelsAsync(id, cancellationToken);
        if (provider == null) return ApiResponse<AiProviderDto>.Fail("AI 供应商不存在");
        return ApiResponse<AiProviderDto>.Ok(Map(provider));
    }

    public async Task<ApiResponse<AiProviderDto>> CreateAsync(CreateAiProviderRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return ApiResponse<AiProviderDto>.Fail("名称不能为空");

        var provider = new AiProvider
        {
            Id = Guid.NewGuid(),
            ProviderType = string.IsNullOrWhiteSpace(request.ProviderType) ? "openai" : request.ProviderType.Trim().ToLowerInvariant(),
            Name = request.Name.Trim(),
            EncryptedApiKey = string.IsNullOrWhiteSpace(request.ApiKey) ? string.Empty : _protector.Protect(request.ApiKey.Trim()),
            BaseUrl = string.IsNullOrWhiteSpace(request.BaseUrl) ? null : request.BaseUrl.Trim(),
            IsEnabled = request.IsEnabled,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.AiProviders.AddAsync(provider, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<AiProviderDto>.Ok(Map(provider));
    }

    public async Task<ApiResponse<AiProviderDto>> UpdateAsync(Guid id, UpdateAiProviderRequest request, CancellationToken cancellationToken = default)
    {
        var provider = await _unitOfWork.AiProviders.GetByIdAsync(id, cancellationToken);
        if (provider == null) return ApiResponse<AiProviderDto>.Fail("AI 供应商不存在");

        provider.ProviderType = string.IsNullOrWhiteSpace(request.ProviderType) ? provider.ProviderType : request.ProviderType.Trim().ToLowerInvariant();
        provider.Name = string.IsNullOrWhiteSpace(request.Name) ? provider.Name : request.Name.Trim();
        if (!string.IsNullOrWhiteSpace(request.ApiKey))
            provider.EncryptedApiKey = _protector.Protect(request.ApiKey.Trim());
        provider.BaseUrl = string.IsNullOrWhiteSpace(request.BaseUrl) ? provider.BaseUrl : request.BaseUrl.Trim();
        provider.IsEnabled = request.IsEnabled;
        provider.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.AiProviders.UpdateAsync(provider, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<AiProviderDto>.Ok(Map(provider));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var provider = await _unitOfWork.AiProviders.GetByIdAsync(id, cancellationToken);
        if (provider == null) return ApiResponse.Fail("AI 供应商不存在");

        await _unitOfWork.AiProviders.DeleteAsync(provider, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<AiProviderDto?>> GetDefaultProviderAsync(string purpose, CancellationToken cancellationToken = default)
    {
        var provider = await _unitOfWork.AiProviders.GetDefaultProviderAsync(purpose, cancellationToken);
        if (provider == null) return ApiResponse<AiProviderDto?>.Ok(null);
        return ApiResponse<AiProviderDto?>.Ok(Map(provider));
    }

    public async Task<ApiResponse<List<RemoteModelInfo>>> FetchRemoteModelsAsync(Guid providerId, CancellationToken cancellationToken = default)
    {
        var provider = await _unitOfWork.AiProviders.GetByIdAsync(providerId, cancellationToken);
        if (provider == null) return ApiResponse<List<RemoteModelInfo>>.Fail("AI 供应商不存在");

        var apiKey = string.IsNullOrWhiteSpace(provider.EncryptedApiKey) ? string.Empty : _protector.Unprotect(provider.EncryptedApiKey);

        try
        {
            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");

            var baseUrl = provider.BaseUrl?.TrimEnd('/') ?? GetDefaultBaseUrl(provider.ProviderType);
            var response = await client.GetAsync($"{baseUrl}/models", cancellationToken);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            var models = ParseModels(json, provider.ProviderType);
            return ApiResponse<List<RemoteModelInfo>>.Ok(models);
        }
        catch (Exception ex)
        {
            return ApiResponse<List<RemoteModelInfo>>.Fail($"获取模型列表失败: {ex.Message}");
        }
    }

    private static string GetDefaultBaseUrl(string providerType) => providerType switch
    {
        "anthropic" => "https://api.anthropic.com/v1",
        _ => "https://api.openai.com/v1"
    };

    private static List<RemoteModelInfo> ParseModels(string json, string providerType)
    {
        var result = new List<RemoteModelInfo>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in data.EnumerateArray())
                {
                    var modelId = item.TryGetProperty("id", out var id) ? id.GetString() : null;
                    if (string.IsNullOrWhiteSpace(modelId)) continue;
                    result.Add(new RemoteModelInfo
                    {
                        ModelId = modelId,
                        DisplayName = modelId,
                    });
                }
            }
        }
        catch
        {
            // JSON 解析失败返回空列表
        }
        return result;
    }

    private AiProviderDto Map(AiProvider provider) => new()
    {
        Id = provider.Id,
        ProviderType = provider.ProviderType,
        Name = provider.Name,
        BaseUrl = provider.BaseUrl,
        IsEnabled = provider.IsEnabled,
        CreatedAt = provider.CreatedAt,
        UpdatedAt = provider.UpdatedAt,
        Models = provider.Models?.Select(m => new AiModelDto
        {
            Id = m.Id,
            ProviderId = m.ProviderId,
            ModelId = m.ModelId,
            DisplayName = m.DisplayName,
            Purpose = m.Purpose,
            IsDefault = m.IsDefault,
            ContextWindow = m.ContextWindow,
            Dimensions = m.Dimensions,
            ReasoningMode = m.ReasoningMode,
            ReasoningEffort = m.ReasoningEffort,
            SupportsVision = m.SupportsVision,
            SupportsReasoning = m.SupportsReasoning,
            SupportsTools = m.SupportsTools,
            IsVisible = m.IsVisible,
            CreatedAt = m.CreatedAt,
            UpdatedAt = m.UpdatedAt
        }).ToList() ?? []
    };
}
