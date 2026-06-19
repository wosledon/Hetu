using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SearchController : ControllerBase
{
    private readonly ISearchService _searchService;
    private readonly ISemanticSearchService _semanticSearchService;

    public SearchController(ISearchService searchService, ISemanticSearchService semanticSearchService)
    {
        _searchService = searchService;
        _semanticSearchService = semanticSearchService;
    }

    [HttpGet("notes")]
    public Task<ApiResponse<PagedResult<NoteSearchResultDto>>> SearchNotes([FromQuery] SearchNotesRequest request, CancellationToken cancellationToken)
        => _searchService.SearchNotesAsync(request, cancellationToken);

    [HttpGet("semantic")]
    public Task<ApiResponse<PagedResult<NoteSearchResultDto>>> SemanticSearch([FromQuery] string query, [FromQuery] int topK = 10, CancellationToken cancellationToken = default)
        => _semanticSearchService.SearchAsync(query, topK, cancellationToken);
}
