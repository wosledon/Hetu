using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/scheduled-tasks")]
public class ScheduledTasksController : ControllerBase
{
    private readonly IScheduledTaskService _service;

    public ScheduledTasksController(IScheduledTaskService service)
    {
        _service = service;
    }

    [HttpGet]
    public Task<ApiResponse<List<ScheduledTaskDto>>> GetAll(CancellationToken ct)
        => _service.GetAllAsync(ct);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<ScheduledTaskDto>> GetById(Guid id, CancellationToken ct)
        => _service.GetByIdAsync(id, ct);

    [HttpGet("target-options")]
    public Task<ApiResponse<ScheduledTaskTargetOptionsDto>> GetTargetOptions(CancellationToken ct)
        => _service.GetTargetOptionsAsync(ct);

    [HttpPost]
    public Task<ApiResponse<ScheduledTaskDto>> Create([FromBody] CreateScheduledTaskRequest request, CancellationToken ct)
        => _service.CreateAsync(request, ct);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<ScheduledTaskDto>> Update(Guid id, [FromBody] UpdateScheduledTaskRequest request, CancellationToken ct)
        => _service.UpdateAsync(id, request, ct);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken ct)
        => _service.DeleteAsync(id, ct);

    [HttpPost("{id:guid}/toggle")]
    public Task<ApiResponse<ScheduledTaskDto>> Toggle(Guid id, CancellationToken ct)
        => _service.ToggleAsync(id, ct);

    [HttpPost("{id:guid}/run")]
    public Task<ApiResponse<ScheduledTaskExecutionDto>> RunNow(Guid id, CancellationToken ct)
        => _service.RunNowAsync(id, ct);

    [HttpGet("{id:guid}/executions")]
    public Task<ApiResponse<List<ScheduledTaskExecutionDto>>> GetExecutions(Guid id, [FromQuery] int limit, CancellationToken ct)
        => _service.GetExecutionsAsync(id, limit, ct);
}
