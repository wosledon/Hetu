using Hetu.Shared.Chat;

namespace Hetu.Core.Interfaces;

public interface IWebSearchService
{
    Task<List<WebSearchResultDto>> SearchAsync(string query, int maxResults = 5, CancellationToken cancellationToken = default);
}
