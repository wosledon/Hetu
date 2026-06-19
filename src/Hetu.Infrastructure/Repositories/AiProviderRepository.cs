using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class AiProviderRepository : EfRepository<AiProvider>, IAiProviderRepository
{
    public AiProviderRepository(HetuDbContext context) : base(context) { }

    public Task<IReadOnlyList<AiProvider>> GetAllWithModelsAsync(CancellationToken cancellationToken = default)
        => DbSet.AsNoTracking()
            .Include(p => p.Models)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken)
            .ContinueWith(t => (IReadOnlyList<AiProvider>)t.Result);

    public Task<AiProvider?> GetByIdWithModelsAsync(Guid id, CancellationToken cancellationToken = default)
        => DbSet.AsNoTracking()
            .Include(p => p.Models)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

    public async Task<AiProvider?> GetDefaultProviderAsync(string purpose, CancellationToken cancellationToken = default)
    {
        var provider = await DbSet.AsNoTracking()
            .Include(p => p.Models)
            .Where(p => p.IsEnabled && p.Models.Any(m => m.Purpose == purpose && m.IsDefault))
            .FirstOrDefaultAsync(cancellationToken);

        return provider;
    }
}
