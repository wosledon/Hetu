using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface INoteService
{
    Task<ApiResponse<PagedResult<NoteDto>>> GetListAsync(GetNotesRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<NoteDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<NoteDto>> CreateAsync(CreateNoteRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<NoteDto>> UpdateAsync(Guid id, UpdateNoteRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse> RestoreAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse> HardDeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse> MoveAsync(Guid id, MoveNoteRequest request, CancellationToken cancellationToken = default);
}

public class GetNotesRequest : PagedRequest
{
    public Guid? NotebookId { get; set; }
    public Guid? TagId { get; set; }
    public bool IncludeDeleted { get; set; }
}
