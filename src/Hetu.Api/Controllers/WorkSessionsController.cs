using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/work-sessions")]
public class WorkSessionsController : ControllerBase
{
    private readonly IWorkSessionService _sessionService;

    public WorkSessionsController(IWorkSessionService sessionService)
    {
        _sessionService = sessionService;
    }

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WorkSessionDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _sessionService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<WorkSessionDto>> Create([FromBody] CreateWorkSessionRequest request, CancellationToken cancellationToken)
        => _sessionService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<WorkSessionDto>> Update(Guid id, [FromBody] UpdateWorkSessionRequest request, CancellationToken cancellationToken)
        => _sessionService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _sessionService.DeleteAsync(id, cancellationToken);

    [HttpGet("{id:guid}/messages")]
    public Task<ApiResponse<List<WorkMessageDto>>> GetMessages(Guid id, CancellationToken cancellationToken)
        => _sessionService.GetMessagesAsync(id, cancellationToken);

    [HttpGet("{id:guid}/file-changes")]
    public async Task<ApiResponse<List<WorkFileChangeDto>>> GetFileChanges(Guid id, CancellationToken cancellationToken)
    {
        var changes = await _sessionService.GetFileChangesAsync(id, cancellationToken);
        return ApiResponse<List<WorkFileChangeDto>>.Ok(changes);
    }

    [HttpPost("{id:guid}/messages")]
    public Task<ApiResponse<WorkMessageDto>> AddMessage(Guid id, [FromBody] AddWorkMessageRequest request, CancellationToken cancellationToken)
        => _sessionService.AddMessageAsync(id, request.Role, request.Content, request.Type, request.Metadata, cancellationToken: cancellationToken);
}

public class AddWorkMessageRequest
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    public string Type { get; set; } = "text";
    public string? Metadata { get; set; }
}
