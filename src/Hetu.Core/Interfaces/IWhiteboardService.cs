using Hetu.Shared.Common;
using Hetu.Shared.Whiteboard;

namespace Hetu.Core.Interfaces;

public interface IWhiteboardService
{
    Task<ApiResponse<PagedResult<WhiteboardListItemDto>>> GetListAsync(int page, int pageSize, CancellationToken cancellationToken = default);
    Task<ApiResponse<WhiteboardDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<WhiteboardDto>> CreateAsync(CreateWhiteboardRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<WhiteboardDto>> UpdateAsync(Guid id, UpdateWhiteboardRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
