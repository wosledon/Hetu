using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/task-items")]
public class TaskItemsController : ControllerBase
{
    private readonly IUnitOfWork _unitOfWork;

    public TaskItemsController(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    [HttpGet]
    public async Task<ApiResponse<List<TaskItemDto>>> GetAll([FromQuery] string? type, [FromQuery] int? status, CancellationToken ct)
    {
        var items = await _unitOfWork.TaskItems.GetAllAsync(ct);
        var query = items.AsEnumerable();

        if (!string.IsNullOrEmpty(type))
            query = query.Where(t => t.TaskType.Equals(type, StringComparison.OrdinalIgnoreCase));
        if (status.HasValue)
            query = query.Where(t => t.Status == status.Value);

        var dtos = query
            .OrderByDescending(t => t.CreatedAt)
            .Take(200)
            .Select(MapToDto)
            .ToList();
        return ApiResponse<List<TaskItemDto>>.Ok(dtos);
    }

    [HttpGet("stats")]
    public async Task<ApiResponse<TaskStatsDto>> GetStats(CancellationToken ct)
    {
        var items = await _unitOfWork.TaskItems.GetAllAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var stats = new TaskStatsDto
        {
            Total = items.Count,
            Queued = items.Count(t => t.Status == 0),
            Running = items.Count(t => t.Status == 1),
            Completed = items.Count(t => t.Status == 2),
            Failed = items.Count(t => t.Status == 3),
            RecentFailed = items.Count(t => t.Status == 3 && t.CreatedAt > now.AddHours(-24)),
        };
        return ApiResponse<TaskStatsDto>.Ok(stats);
    }

    [HttpDelete("{id:guid}")]
    public async Task<ApiResponse> Delete(Guid id, CancellationToken ct)
    {
        var item = await _unitOfWork.TaskItems.GetByIdAsync(id, ct);
        if (item is null) return ApiResponse.Fail("记录不存在");

        item.IsDeleted = true;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.TaskItems.UpdateAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse.Ok();
    }

    [HttpDelete("completed")]
    public async Task<ApiResponse> ClearCompleted(CancellationToken ct)
    {
        var items = await _unitOfWork.TaskItems.FindAsync(t => t.Status == 2, ct);
        foreach (var item in items)
        {
            item.IsDeleted = true;
            item.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.TaskItems.UpdateAsync(item, ct);
        }
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse.Ok();
    }

    private static TaskItemDto MapToDto(TaskItem t) => new()
    {
        Id = t.Id,
        TaskType = t.TaskType,
        EntityId = t.EntityId,
        EntityTitle = t.EntityTitle,
        Status = t.Status,
        ErrorMessage = t.ErrorMessage,
        StartedAt = t.StartedAt,
        CompletedAt = t.CompletedAt,
        CreatedAt = t.CreatedAt,
        DurationMs = t.StartedAt.HasValue && t.CompletedAt.HasValue
            ? (long)(t.CompletedAt.Value - t.StartedAt.Value).TotalMilliseconds
            : null,
    };
}

public class TaskItemDto
{
    public Guid Id { get; set; }
    public string TaskType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public string? EntityTitle { get; set; }
    public int Status { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public long? DurationMs { get; set; }
}

public class TaskStatsDto
{
    public int Total { get; set; }
    public int Queued { get; set; }
    public int Running { get; set; }
    public int Completed { get; set; }
    public int Failed { get; set; }
    public int RecentFailed { get; set; }
}
