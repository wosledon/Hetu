using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface INoteVersionService
{
    Task<ApiResponse<List<NoteVersionDto>>> GetVersionsAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task<ApiResponse<NoteVersionDto>> GetVersionAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<NoteDto>> RestoreVersionAsync(Guid id, CancellationToken cancellationToken = default);
}
