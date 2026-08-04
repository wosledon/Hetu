using Hetu.Shared.Common;
using Hetu.Shared.Work;

namespace Hetu.Core.Interfaces;

public interface IWorkProjectService
{
    Task<ApiResponse<List<WorkProjectDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkProjectDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkProjectDto>> CreateAsync(CreateWorkProjectRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkProjectDto>> UpdateAsync(Guid id, UpdateWorkProjectRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}

public interface IWorkSessionService
{
    Task<ApiResponse<List<WorkSessionDto>>> GetByProjectAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkSessionDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkSessionDto>> CreateAsync(CreateWorkSessionRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkSessionDto>> UpdateAsync(Guid id, UpdateWorkSessionRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<WorkMessageDto>>> GetMessagesAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkMessageDto>> AddMessageAsync(Guid sessionId, string role, string content, string type = "text", string? metadata = null, Guid? modelId = null, CancellationToken cancellationToken = default);
}
