using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Settings;

namespace Hetu.Core.Services;

public class AppSettingService : IAppSettingService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILanguagePreference _language;
    private readonly ILocalizer _localizer;

    public AppSettingService(IUnitOfWork unitOfWork, ILanguagePreference language, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _language = language;
        _localizer = localizer;
    }

    public async Task<ApiResponse<AppSettingsSnapshotDto>> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var snapshot = new AppSettingsSnapshotDto
        {
            AppName = await GetValueAsync("AppName", "Hetu", cancellationToken),
            AssistantName = await GetValueAsync("AssistantName", _localizer.T("settings.defaultAssistantName"), cancellationToken),
            AssistantPersona = await GetValueAsync("AssistantPersona", "", cancellationToken),
            Theme = await GetValueAsync("Theme", "system", cancellationToken),
            Language = await GetValueAsync("Language", "zh", cancellationToken),
            GraphAutoExtract = await GetValueAsync("GraphAutoExtract", "false", cancellationToken),
            AutoEmbedding = await GetValueAsync("AutoEmbedding", "false", cancellationToken),
            DefaultChatModelId = await GetNullableValueAsync("DefaultChatModelId", cancellationToken),
            DefaultChunkModelId = await GetNullableValueAsync("DefaultChunkModelId", cancellationToken),
            DefaultFastModelId = await GetNullableValueAsync("DefaultFastModelId", cancellationToken),
            DefaultEmbeddingModelId = await GetNullableValueAsync("DefaultEmbeddingModelId", cancellationToken),
            DefaultWikiModelId = await GetNullableValueAsync("DefaultWikiModelId", cancellationToken),
            DefaultGraphModelId = await GetNullableValueAsync("DefaultGraphModelId", cancellationToken),
            DefaultOrganizeModelId = await GetNullableValueAsync("DefaultOrganizeModelId", cancellationToken),
            DefaultNoteAiModelId = await GetNullableValueAsync("DefaultNoteAiModelId", cancellationToken),
            ContextWindowSize = await GetNullableIntValueAsync("ContextWindowSize", cancellationToken),
            PinnedNavItems = await GetValueAsync("PinnedNavItems", "[]", cancellationToken),
            SecondaryMenuStyle = await GetValueAsync("SecondaryMenuStyle", "flat", cancellationToken),
            NavStyle = await GetValueAsync("NavStyle", "top", cancellationToken),
            CloseToTray = await GetValueAsync("CloseToTray", "true", cancellationToken),
        };
        // 前端启动即读快照，顺手同步后台任务使用的语言偏好
        _language.Language = snapshot.Language;
        return ApiResponse<AppSettingsSnapshotDto>.Ok(snapshot);
    }

    public async Task<ApiResponse<AppSettingDto?>> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync(key, cancellationToken);
        if (setting == null) return ApiResponse<AppSettingDto?>.Ok(null);
        return ApiResponse<AppSettingDto?>.Ok(Map(setting));
    }

    public async Task<ApiResponse> SetAsync(UpdateAppSettingRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return ApiResponse.Fail(_localizer.T("api.settingKeyRequired"));

        var existing = await _unitOfWork.AppSettings.GetByKeyAsync(request.Key, cancellationToken);
        if (existing == null)
        {
            await _unitOfWork.AppSettings.SetAsync(new AppSetting
            {
                Key = request.Key.Trim(),
                Value = request.Value,
                UpdatedAt = DateTimeOffset.UtcNow
            }, cancellationToken);
        }
        else
        {
            existing.Value = request.Value;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.AppSettings.SetAsync(existing, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        // 语言设置立即影响后台任务（没有请求头的场景）
        if (string.Equals(request.Key.Trim(), "Language", StringComparison.OrdinalIgnoreCase))
            _language.Language = request.Value ?? "zh";
        return ApiResponse.Ok();
    }

    private async Task<string> GetValueAsync(string key, string defaultValue, CancellationToken cancellationToken)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync(key, cancellationToken);
        return string.IsNullOrWhiteSpace(setting?.Value) ? defaultValue : setting.Value;
    }

    private async Task<string?> GetNullableValueAsync(string key, CancellationToken cancellationToken)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync(key, cancellationToken);
        return string.IsNullOrWhiteSpace(setting?.Value) ? null : setting.Value;
    }

    private async Task<int?> GetNullableIntValueAsync(string key, CancellationToken cancellationToken)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync(key, cancellationToken);
        if (string.IsNullOrWhiteSpace(setting?.Value)) return null;
        return int.TryParse(setting.Value, out var val) ? val : null;
    }

    private static AppSettingDto Map(AppSetting setting) => new()
    {
        Key = setting.Key,
        Value = setting.Value,
        UpdatedAt = setting.UpdatedAt
    };
}
