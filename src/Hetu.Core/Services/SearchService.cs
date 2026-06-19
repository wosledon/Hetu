using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class SearchService : ISearchService
{
    private readonly IUnitOfWork _unitOfWork;

    public SearchService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<PagedResult<NoteSearchResultDto>>> SearchNotesAsync(SearchNotesRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Keyword))
        {
            return ApiResponse<PagedResult<NoteSearchResultDto>>.Ok(new PagedResult<NoteSearchResultDto>());
        }

        var notes = await _unitOfWork.Notes.SearchAsync(
            request.Keyword.Trim(),
            request.NotebookId,
            request.TagId,
            request.IncludeDeleted,
            cancellationToken);

        var total = notes.Count;
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Max(1, request.PageSize);
        var keyword = request.Keyword.Trim();

        var items = notes
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(n => new NoteSearchResultDto
            {
                Id = n.Id,
                Title = n.Title,
                ContentSnippet = MakeSnippet(n.Content, keyword),
                UpdatedAt = n.UpdatedAt
            })
            .ToList();

        return ApiResponse<PagedResult<NoteSearchResultDto>>.Ok(new PagedResult<NoteSearchResultDto>
        {
            Items = items,
            TotalCount = total,
            Page = page,
            PageSize = pageSize
        });
    }

    private static string? MakeSnippet(string content, string keyword)
    {
        if (string.IsNullOrWhiteSpace(content)) return null;
        var index = content.IndexOf(keyword, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return content.Length > 120 ? content[..120] + "..." : content;

        var start = Math.Max(0, index - 40);
        var end = Math.Min(content.Length, index + keyword.Length + 80);
        var snippet = content[start..end];
        return (start > 0 ? "..." : string.Empty) + snippet + (end < content.Length ? "..." : string.Empty);
    }
}
