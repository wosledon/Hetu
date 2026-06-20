using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class AppSettingRepository : IAppSettingRepository
{
    private readonly HetuDbContext _context;

    public AppSettingRepository(HetuDbContext context)
    {
        _context = context;
    }

    public Task<AppSetting?> GetByKeyAsync(string key, CancellationToken cancellationToken = default)
        => _context.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key, cancellationToken);

    public async Task<IReadOnlyList<AppSetting>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var result = await _context.AppSettings.AsNoTracking().ToListAsync(cancellationToken);
        return result;
    }

    public async Task<AppSetting> SetAsync(AppSetting setting, CancellationToken cancellationToken = default)
    {
        var existing = await _context.AppSettings.FirstOrDefaultAsync(s => s.Key == setting.Key, cancellationToken);
        if (existing == null)
        {
            _context.AppSettings.Add(setting);
            return setting;
        }

        existing.Value = setting.Value;
        existing.UpdatedAt = setting.UpdatedAt;
        return existing;
    }
}
