using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface INotebookService
{
    Task<ApiResponse<List<NotebookDto>>> GetTreeAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<NotebookDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<NotebookDto>> CreateAsync(CreateNotebookRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<NotebookDto>> UpdateAsync(Guid id, UpdateNotebookRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
