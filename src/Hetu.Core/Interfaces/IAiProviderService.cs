using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IAiProviderService
{
    Task<ApiResponse<List<AiProviderDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto>> CreateAsync(CreateAiProviderRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto>> UpdateAsync(Guid id, UpdateAiProviderRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto?>> GetDefaultProviderAsync(string purpose, CancellationToken cancellationToken = default);
}
