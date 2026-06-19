using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NotesController : ControllerBase
{
    private readonly INoteService _noteService;
    private readonly INoteAiService _noteAiService;

    public NotesController(INoteService noteService, INoteAiService noteAiService)
    {
        _noteService = noteService;
        _noteAiService = noteAiService;
    }

    [HttpGet]
    public Task<ApiResponse<PagedResult<NoteDto>>> GetList([FromQuery] GetNotesRequest request, CancellationToken cancellationToken)
        => _noteService.GetListAsync(request, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<NoteDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _noteService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<NoteDto>> Create([FromBody] CreateNoteRequest request, CancellationToken cancellationToken)
        => _noteService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<NoteDto>> Update(Guid id, [FromBody] UpdateNoteRequest request, CancellationToken cancellationToken)
        => _noteService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _noteService.DeleteAsync(id, cancellationToken);

    [HttpPost("{id:guid}/restore")]
    public Task<ApiResponse> Restore(Guid id, CancellationToken cancellationToken)
        => _noteService.RestoreAsync(id, cancellationToken);

    [HttpDelete("{id:guid}/hard")]
    public Task<ApiResponse> HardDelete(Guid id, CancellationToken cancellationToken)
        => _noteService.HardDeleteAsync(id, cancellationToken);

    [HttpPost("{id:guid}/move")]
    public Task<ApiResponse> Move(Guid id, [FromBody] MoveNoteRequest request, CancellationToken cancellationToken)
        => _noteService.MoveAsync(id, request, cancellationToken);

    [HttpPost("{id:guid}/summarize")]
    public IAsyncEnumerable<string> Summarize(Guid id, [FromBody] NoteAiRequest request, CancellationToken cancellationToken)
        => _noteAiService.SummarizeAsync(id, request, cancellationToken);

    [HttpPost("{id:guid}/continue")]
    public IAsyncEnumerable<string> Continue(Guid id, [FromBody] ContinueNoteRequest request, CancellationToken cancellationToken)
        => _noteAiService.ContinueAsync(id, request, cancellationToken);
}
