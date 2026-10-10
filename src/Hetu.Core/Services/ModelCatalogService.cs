using System.Globalization;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

/// <summary>
/// models.dev（https://models.dev）开放模型目录客户端。
/// 首次访问时拉取全量目录并在内存中缓存，供「添加模型」时按关键词检索、
/// 自动填充上下文窗口 / 视觉 / 工具 / 推理强度等能力配置。
/// </summary>
public class ModelCatalogService : IModelCatalogService
{
    private const string CatalogUrl = "https://models.dev/api.json";
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromHours(6);

    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static List<CatalogModelInfo> _models = [];
    private static List<CatalogProviderInfo> _providers = [];
    private static DateTimeOffset _cachedAt = DateTimeOffset.MinValue;

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILocalizer _localizer;

    public ModelCatalogService(IHttpClientFactory httpClientFactory, ILocalizer localizer)
    {
        _httpClientFactory = httpClientFactory;
        _localizer = localizer;
    }

    public async Task<ApiResponse<List<CatalogModelInfo>>> SearchAsync(string? keyword, int limit = 30, CancellationToken cancellationToken = default)
    {
        if (limit <= 0) limit = 30;
        if (limit > 100) limit = 100;

        var loadResult = await EnsureLoadedAsync(cancellationToken);
        if (!loadResult.Success) return ApiResponse<List<CatalogModelInfo>>.Fail(loadResult.Error ?? _localizer.T("modelCatalog.loadFailed"));

        var keywordText = keyword?.Trim();
            var matches = string.IsNullOrWhiteSpace(keywordText)
            ? _models
            : _models
                .Select(m => (model: m, score: Score(m, keywordText)))
                .Where(x => x.score < int.MaxValue)
                .OrderBy(x => x.score)
                .ThenBy(x => x.model.ProviderId, StringComparer.Ordinal)
                .ThenBy(x => x.model.ModelId, StringComparer.Ordinal)
                .Select(x => x.model);

        return ApiResponse<List<CatalogModelInfo>>.Ok(matches.Take(limit).ToList());
    }

    public async Task<ApiResponse<List<CatalogProviderInfo>>> GetProvidersAsync(CancellationToken cancellationToken = default)
    {
        var loadResult = await EnsureLoadedAsync(cancellationToken);
        if (!loadResult.Success) return ApiResponse<List<CatalogProviderInfo>>.Fail(loadResult.Error ?? _localizer.T("modelCatalog.loadFailed"));
        return ApiResponse<List<CatalogProviderInfo>>.Ok(_providers);
    }

    public async Task<ApiResponse<List<CatalogProviderInfo>>> SearchProvidersAsync(string? keyword, int limit = 20, CancellationToken cancellationToken = default)
    {
        if (limit <= 0) limit = 20;
        if (limit > 50) limit = 50;

        var loadResult = await EnsureLoadedAsync(cancellationToken);
        if (!loadResult.Success) return ApiResponse<List<CatalogProviderInfo>>.Fail(loadResult.Error ?? _localizer.T("modelCatalog.loadFailed"));

        var keywordText = keyword?.Trim();
        var matches = string.IsNullOrWhiteSpace(keywordText)
            ? _providers
            : _providers
                .Select(p => (provider: p, score: ScoreProvider(p, keywordText)))
                .Where(x => x.score < int.MaxValue)
                .OrderBy(x => x.score)
                .ThenBy(x => x.provider.Id, StringComparer.Ordinal)
                .Select(x => x.provider);

        return ApiResponse<List<CatalogProviderInfo>>.Ok(matches.Take(limit).ToList());
    }

    public async Task<ApiResponse<CatalogProviderDetail>> GetProviderAsync(string? providerId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(providerId))
            return ApiResponse<CatalogProviderDetail>.Fail(_localizer.T("modelCatalog.providerIdRequired"));

        var loadResult = await EnsureLoadedAsync(cancellationToken);
        if (!loadResult.Success) return ApiResponse<CatalogProviderDetail>.Fail(loadResult.Error ?? _localizer.T("modelCatalog.loadFailed"));

        var id = providerId.Trim();
        var provider = _providers.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase));
        if (provider == null) return ApiResponse<CatalogProviderDetail>.Fail(_localizer.T("modelCatalog.providerNotFound"));

        return ApiResponse<CatalogProviderDetail>.Ok(new CatalogProviderDetail
        {
            Id = provider.Id,
            Name = provider.Name,
            Api = provider.Api,
            Env = provider.Env,
            Npm = provider.Npm,
            Doc = provider.Doc,
            ModelCount = provider.ModelCount,
            Models = _models.Where(m => string.Equals(m.ProviderId, id, StringComparison.OrdinalIgnoreCase)).ToList()
        });
    }

    /// <summary>0 为最相关，<see cref="int.MaxValue"/> 表示不匹配。</summary>
    private static int ScoreProvider(CatalogProviderInfo provider, string keyword)
    {
        if (provider.Id.Equals(keyword, StringComparison.OrdinalIgnoreCase)) return 0;
        if ((provider.Name ?? string.Empty).Equals(keyword, StringComparison.OrdinalIgnoreCase)) return 1;
        if (provider.Id.StartsWith(keyword, StringComparison.OrdinalIgnoreCase)) return 2;
        if ((provider.Name ?? string.Empty).StartsWith(keyword, StringComparison.OrdinalIgnoreCase)) return 3;
        if (provider.Id.Contains(keyword, StringComparison.OrdinalIgnoreCase)) return 4;
        if ((provider.Name ?? string.Empty).Contains(keyword, StringComparison.OrdinalIgnoreCase)) return 5;
        return int.MaxValue;
    }

    /// <summary>0 为最相关，<see cref="int.MaxValue"/> 表示不匹配。</summary>
    private static int Score(CatalogModelInfo model, string keyword)
    {
        var id = model.ModelId;
        var name = model.Name ?? string.Empty;
        var provider = model.ProviderId;
        var providerName = model.ProviderName;

        if (id.Equals(keyword, StringComparison.OrdinalIgnoreCase)) return 0;
        if (name.Equals(keyword, StringComparison.OrdinalIgnoreCase)) return 1;
        if (id.StartsWith(keyword, StringComparison.OrdinalIgnoreCase)) return 2;
        if (name.StartsWith(keyword, StringComparison.OrdinalIgnoreCase)) return 3;
        if (id.Contains(keyword, StringComparison.OrdinalIgnoreCase)) return 4;
        if (name.Contains(keyword, StringComparison.OrdinalIgnoreCase)) return 5;
        if (provider.Contains(keyword, StringComparison.OrdinalIgnoreCase)) return 6;
        if (providerName.Contains(keyword, StringComparison.OrdinalIgnoreCase)) return 7;
        return int.MaxValue;
    }

    private async Task<ApiResponse> EnsureLoadedAsync(CancellationToken cancellationToken)
    {
        if (_models.Count > 0 && DateTimeOffset.UtcNow - _cachedAt < CacheLifetime)
            return ApiResponse.Ok();

        await Gate.WaitAsync(cancellationToken);
        try
        {
            if (_models.Count > 0 && DateTimeOffset.UtcNow - _cachedAt < CacheLifetime)
                return ApiResponse.Ok();

            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(60);
            using var response = await client.GetAsync(CatalogUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

            var models = new List<CatalogModelInfo>(10_000);
            var providers = new List<CatalogProviderInfo>(256);

            foreach (var providerProperty in document.RootElement.EnumerateObject())
            {
                if (!providerProperty.Value.TryGetProperty("models", out var modelsElement) ||
                    modelsElement.ValueKind != JsonValueKind.Object)
                    continue;

                var providerId = providerProperty.Name;
                var providerName = providerProperty.Value.TryGetProperty("name", out var providerNameElement)
                    ? providerNameElement.GetString() ?? providerId
                    : providerId;
                var providerApi = providerProperty.Value.TryGetProperty("api", out var apiElement) ? apiElement.GetString() : null;
                var providerEnv = providerProperty.Value.TryGetProperty("env", out var envElement) && envElement.ValueKind == JsonValueKind.Array
                    ? envElement.EnumerateArray().Select(e => e.GetString()).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))
                    : null;
                var providerNpm = providerProperty.Value.TryGetProperty("npm", out var npmElement) ? npmElement.GetString() : null;
                var providerDoc = providerProperty.Value.TryGetProperty("doc", out var docElement) ? docElement.GetString() : null;

                var providerModels = new List<CatalogModelInfo>(modelsElement.EnumerateObject().Count());
                foreach (var modelProperty in modelsElement.EnumerateObject())
                {
                    var model = ParseModel(providerId, providerName, modelProperty);
                    if (model != null) providerModels.Add(model);
                }

                if (providerModels.Count == 0) continue;

                providers.Add(new CatalogProviderInfo
                {
                    Id = providerId,
                    Name = providerName,
                    Api = providerApi,
                    Env = providerEnv,
                    Npm = providerNpm,
                    Doc = providerDoc,
                    ModelCount = providerModels.Count
                });
                models.AddRange(providerModels);
            }

            if (models.Count == 0) return ApiResponse.Fail(_localizer.T("modelCatalog.emptyOrInvalid"));

            _providers = providers;
            _models = models;
            _cachedAt = DateTimeOffset.UtcNow;
            return ApiResponse.Ok();
        }
        catch (Exception ex)
        {
            return ApiResponse.Fail(_localizer.T("modelCatalog.fetchFailed", ex.Message));
        }
        finally
        {
            Gate.Release();
        }
    }

    private static CatalogModelInfo? ParseModel(string providerId, string providerName, JsonProperty modelProperty)
    {
        var element = modelProperty.Value;
        var modelId = element.TryGetProperty("id", out var idElement) ? idElement.GetString() : modelProperty.Name;
        if (string.IsNullOrWhiteSpace(modelId)) return null;

        var info = new CatalogModelInfo
        {
            ProviderId = providerId,
            ProviderName = providerName,
            ModelId = modelId,
            Name = element.TryGetProperty("name", out var nameElement) ? nameElement.GetString() ?? modelId : modelId,
            Description = element.TryGetProperty("description", out var descriptionElement) ? descriptionElement.GetString() : null,
            Family = element.TryGetProperty("family", out var familyElement) ? familyElement.GetString() : null,
            Reasoning = element.TryGetProperty("reasoning", out var reasoningElement) && reasoningElement.ValueKind == JsonValueKind.True,
            SupportsVision = element.TryGetProperty("attachment", out var attachmentElement) && attachmentElement.ValueKind == JsonValueKind.True,
            SupportsTools = element.TryGetProperty("tool_call", out var toolElement) && toolElement.ValueKind == JsonValueKind.True,
            ReleaseDate = element.TryGetProperty("release_date", out var releaseElement) ? releaseElement.GetString() : null,
        };

        if (element.TryGetProperty("modalities", out var modalities) &&
            modalities.TryGetProperty("input", out var inputModalities) &&
            inputModalities.ValueKind == JsonValueKind.Array)
        {
            foreach (var modality in inputModalities.EnumerateArray())
            {
                if (string.Equals(modality.GetString(), "image", StringComparison.OrdinalIgnoreCase))
                {
                    info.SupportsVision = true;
                    break;
                }
            }
        }

        if (element.TryGetProperty("limit", out var limit) && limit.ValueKind == JsonValueKind.Object)
        {
            info.ContextWindow = ReadPositiveInt(limit, "context");
            info.MaxOutputTokens = ReadPositiveInt(limit, "output");
        }

        if (element.TryGetProperty("reasoning_options", out var reasoningOptions) &&
            reasoningOptions.ValueKind == JsonValueKind.Array)
        {
            foreach (var option in reasoningOptions.EnumerateArray())
            {
                var type = option.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;
                switch (type)
                {
                    case "effort":
                        if (option.TryGetProperty("values", out var values) && values.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var value in values.EnumerateArray())
                            {
                                var effort = value.GetString();
                                if (!string.IsNullOrWhiteSpace(effort) && !info.ReasoningEffortValues.Contains(effort))
                                    info.ReasoningEffortValues.Add(effort);
                            }
                        }
                        break;
                    case "budget_tokens":
                        info.ReasoningBudgetMin = ReadPositiveInt(option, "min");
                        break;
                    case "toggle":
                        info.ReasoningToggleOnly = true;
                        break;
                }
            }

            info.ReasoningToggleOnly &= info.ReasoningEffortValues.Count == 0 && info.ReasoningBudgetMin is null or <= 0;
        }

        return info;
    }

    private static int? ReadPositiveInt(JsonElement parent, string propertyName) =>
        parent.TryGetProperty(propertyName, out var element) &&
        element.ValueKind == JsonValueKind.Number &&
        element.TryGetInt32(out var value) &&
        value > 0
            ? value
            : null;
}
