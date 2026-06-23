using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IAgentService
{
    Task<ApiResponse<List<AgentDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<AgentDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<AgentDto>> CreateAsync(CreateAgentRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<AgentDto>> UpdateAsync(Guid id, UpdateAgentRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
