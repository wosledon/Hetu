using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/notes/{noteId:guid}/versions")]
public class NoteVersionsController : ControllerBase
{
    private readonly INoteVersionService _noteVersionService;

    public NoteVersionsController(INoteVersionService noteVersionService)
    {
        _noteVersionService = noteVersionService;
    }

    [HttpGet]
    public Task<ApiResponse<List<NoteVersionDto>>> GetVersions(Guid noteId, CancellationToken cancellationToken)
        => _noteVersionService.GetVersionsAsync(noteId, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<NoteVersionDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _noteVersionService.GetVersionAsync(id, cancellationToken);

    [HttpPost("{id:guid}/restore")]
    public Task<ApiResponse<NoteDto>> Restore(Guid id, CancellationToken cancellationToken)
        => _noteVersionService.RestoreVersionAsync(id, cancellationToken);
}
