using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface ITagService
{
    Task<ApiResponse<List<TagDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<TagDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<TagDto>> CreateAsync(CreateTagRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<TagDto>> UpdateAsync(Guid id, UpdateTagRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse> MergeAsync(MergeTagsRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<TagDto>>> GetByNoteAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task<ApiResponse> SetNoteTagsAsync(Guid noteId, ManageNoteTagsRequest request, CancellationToken cancellationToken = default);
}
