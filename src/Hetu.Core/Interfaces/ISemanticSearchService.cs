using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface ISemanticSearchService
{
    Task<ApiResponse<PagedResult<NoteSearchResultDto>>> SearchAsync(string query, int topK = 10, CancellationToken cancellationToken = default);
}
