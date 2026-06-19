using Hetu.Shared.Common;
using Hetu.Shared.Settings;

namespace Hetu.Core.Interfaces;

public interface IAppSettingService
{
    Task<ApiResponse<AppSettingsSnapshotDto>> GetSnapshotAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<AppSettingDto?>> GetAsync(string key, CancellationToken cancellationToken = default);
    Task<ApiResponse> SetAsync(UpdateAppSettingRequest request, CancellationToken cancellationToken = default);
}
