using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface ISearchService
{
    Task<ApiResponse<PagedResult<NoteSearchResultDto>>> SearchNotesAsync(SearchNotesRequest request, CancellationToken cancellationToken = default);
}
