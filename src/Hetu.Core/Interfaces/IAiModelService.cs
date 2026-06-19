using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IAiModelService
{
    Task<ApiResponse<List<AiModelDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<List<AiModelDto>>> GetByProviderAsync(Guid providerId, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiModelDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiModelDto>> CreateAsync(CreateAiModelRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiModelDto>> UpdateAsync(Guid id, UpdateAiModelRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse> SetDefaultAsync(Guid id, CancellationToken cancellationToken = default);
}
