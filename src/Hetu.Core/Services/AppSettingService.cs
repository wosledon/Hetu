using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Settings;

namespace Hetu.Core.Services;

public class AppSettingService : IAppSettingService
{
    private readonly IUnitOfWork _unitOfWork;

    public AppSettingService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<AppSettingsSnapshotDto>> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var snapshot = new AppSettingsSnapshotDto
        {
            AppName = await GetValueAsync("AppName", "Hetu", cancellationToken),
            Theme = await GetValueAsync("Theme", "system", cancellationToken),
            GraphAutoExtract = await GetValueAsync("GraphAutoExtract", "false", cancellationToken)
        };
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
            return ApiResponse.Fail("设置键不能为空");

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
        return ApiResponse.Ok();
    }

    private async Task<string> GetValueAsync(string key, string defaultValue, CancellationToken cancellationToken)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync(key, cancellationToken);
        return string.IsNullOrWhiteSpace(setting?.Value) ? defaultValue : setting.Value;
    }

    private static AppSettingDto Map(AppSetting setting) => new()
    {
        Key = setting.Key,
        Value = setting.Value,
        UpdatedAt = setting.UpdatedAt
    };
}
