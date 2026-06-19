using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface IAiModelRepository : IRepository<AiModel>
{
    Task<IReadOnlyList<AiModel>> GetByProviderAsync(Guid providerId, CancellationToken cancellationToken = default);
    Task<AiModel?> GetDefaultByPurposeAsync(string purpose, CancellationToken cancellationToken = default);
    Task ClearDefaultAsync(string purpose, CancellationToken cancellationToken = default);
}
