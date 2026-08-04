using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/work-projects")]
public class WorkProjectsController : ControllerBase
{
    private readonly IWorkProjectService _projectService;
    private readonly IWorkSessionService _sessionService;

    public WorkProjectsController(IWorkProjectService projectService, IWorkSessionService sessionService)
    {
        _projectService = projectService;
        _sessionService = sessionService;
    }

    [HttpGet]
    public Task<ApiResponse<List<WorkProjectDto>>> GetAll(CancellationToken cancellationToken)
        => _projectService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WorkProjectDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _projectService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<WorkProjectDto>> Create([FromBody] CreateWorkProjectRequest request, CancellationToken cancellationToken)
        => _projectService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<WorkProjectDto>> Update(Guid id, [FromBody] UpdateWorkProjectRequest request, CancellationToken cancellationToken)
        => _projectService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _projectService.DeleteAsync(id, cancellationToken);

    [HttpGet("{id:guid}/sessions")]
    public Task<ApiResponse<List<WorkSessionDto>>> GetSessions(Guid id, CancellationToken cancellationToken)
        => _sessionService.GetByProjectAsync(id, cancellationToken);
}
