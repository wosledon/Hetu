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
    /// <summary>父笔记 Id；为空且 FilterRoot 为 false 时返回全部笔记</summary>
    public Guid? ParentId { get; set; }
    /// <summary>只返回根级笔记（ParentId 为空）</summary>
    public bool FilterRoot { get; set; }
    public Guid? TagId { get; set; }
    public bool IncludeDeleted { get; set; }
}
