using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface IAiProviderRepository : IRepository<AiProvider>
{
    Task<IReadOnlyList<AiProvider>> GetAllWithModelsAsync(CancellationToken cancellationToken = default);
    Task<AiProvider?> GetByIdWithModelsAsync(Guid id, CancellationToken cancellationToken = default);
    Task<AiProvider?> GetDefaultProviderAsync(string purpose, CancellationToken cancellationToken = default);
}
