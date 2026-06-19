using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ShareLinksController : ControllerBase
{
    private readonly IShareLinkService _shareLinkService;

    public ShareLinksController(IShareLinkService shareLinkService)
    {
        _shareLinkService = shareLinkService;
    }

    [HttpPost]
    public Task<ApiResponse<ShareLinkDto>> Create([FromBody] CreateShareLinkRequest request, CancellationToken cancellationToken)
        => _shareLinkService.CreateAsync(request, cancellationToken);

    [HttpGet("note/{noteId:guid}")]
    public Task<ApiResponse<List<ShareLinkDto>>> GetByNote(Guid noteId, CancellationToken cancellationToken)
        => _shareLinkService.GetByNoteAsync(noteId, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Deactivate(Guid id, CancellationToken cancellationToken)
        => _shareLinkService.DeactivateAsync(id, cancellationToken);
}

[ApiController]
[Route("api/share")]
public class ShareController : ControllerBase
{
    private readonly IShareLinkService _shareLinkService;

    public ShareController(IShareLinkService shareLinkService)
    {
        _shareLinkService = shareLinkService;
    }

    [HttpGet("{shareCode}")]
    public Task<ApiResponse<SharedNoteDto>> GetSharedNote(string shareCode, CancellationToken cancellationToken)
        => _shareLinkService.GetSharedNoteAsync(shareCode, cancellationToken);
}
