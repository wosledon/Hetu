using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class AiModelRepository : EfRepository<AiModel>, IAiModelRepository
{
    public AiModelRepository(HetuDbContext context) : base(context) { }

    public Task<IReadOnlyList<AiModel>> GetByProviderAsync(Guid providerId, CancellationToken cancellationToken = default)
        => DbSet.AsNoTracking()
            .Where(m => m.ProviderId == providerId)
            .OrderBy(m => m.DisplayName)
            .ToListAsync(cancellationToken)
            .ContinueWith(t => (IReadOnlyList<AiModel>)t.Result);

    public Task<AiModel?> GetDefaultByPurposeAsync(string purpose, CancellationToken cancellationToken = default)
        => DbSet.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Purpose == purpose && m.IsDefault, cancellationToken);

    public async Task ClearDefaultAsync(string purpose, CancellationToken cancellationToken = default)
    {
        var defaults = await DbSet.Where(m => m.Purpose == purpose && m.IsDefault).ToListAsync(cancellationToken);
        foreach (var model in defaults)
        {
            model.IsDefault = false;
            model.UpdatedAt = DateTimeOffset.UtcNow;
        }
        DbSet.UpdateRange(defaults);
    }
}
