using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface IShareLinkService
{
    Task<ApiResponse<ShareLinkDto>> CreateAsync(CreateShareLinkRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<ShareLinkDto>>> GetByNoteAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeactivateAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<SharedNoteDto>> GetSharedNoteAsync(string shareCode, CancellationToken cancellationToken = default);
}
