using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NotebooksController : ControllerBase
{
    private readonly INotebookService _notebookService;

    public NotebooksController(INotebookService notebookService)
    {
        _notebookService = notebookService;
    }

    [HttpGet]
    public Task<ApiResponse<List<NotebookDto>>> GetTree(CancellationToken cancellationToken)
        => _notebookService.GetTreeAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<NotebookDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _notebookService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<NotebookDto>> Create([FromBody] CreateNotebookRequest request, CancellationToken cancellationToken)
        => _notebookService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<NotebookDto>> Update(Guid id, [FromBody] UpdateNotebookRequest request, CancellationToken cancellationToken)
        => _notebookService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _notebookService.DeleteAsync(id, cancellationToken);
}
