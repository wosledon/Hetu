using Hetu.Shared.Common;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Interfaces;

public interface IWorkflowService
{
    Task<ApiResponse<List<WorkflowDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkflowDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkflowDto>> CreateAsync(CreateWorkflowRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkflowDto>> UpdateAsync(Guid id, UpdateWorkflowRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkflowDto>> DuplicateAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ValidationResultDto>> ValidateAsync(Guid id, CancellationToken cancellationToken = default);
}
