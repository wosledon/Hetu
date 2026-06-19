using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface IAppSettingRepository
{
    Task<AppSetting?> GetByKeyAsync(string key, CancellationToken cancellationToken = default);
    Task<AppSetting> SetAsync(AppSetting setting, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<AppSetting>> GetAllAsync(CancellationToken cancellationToken = default);
}
