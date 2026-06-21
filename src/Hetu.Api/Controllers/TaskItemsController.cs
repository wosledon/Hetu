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
    public async Task<ApiResponse<List<TaskItemDto>>> GetAll(CancellationToken ct)
    {
        var items = await _unitOfWork.TaskItems.GetAllAsync(ct);
        var dtos = items
            .OrderByDescending(t => t.Priority)
            .ThenBy(t => t.SortOrder)
            .ThenByDescending(t => t.UpdatedAt)
            .Select(MapToDto)
            .ToList();
        return ApiResponse<List<TaskItemDto>>.Ok(dtos);
    }

    [HttpGet("{id:guid}")]
    public async Task<ApiResponse<TaskItemDto>> GetById(Guid id, CancellationToken ct)
    {
        var item = await _unitOfWork.TaskItems.GetByIdAsync(id, ct);
        if (item is null) return ApiResponse<TaskItemDto>.Fail("任务不存在");
        return ApiResponse<TaskItemDto>.Ok(MapToDto(item));
    }

    [HttpPost]
    public async Task<ApiResponse<TaskItemDto>> Create([FromBody] CreateTaskItemRequest request, CancellationToken ct)
    {
        var item = new TaskItem
        {
            Id = Guid.NewGuid(),
            Title = request.Title,
            Description = request.Description,
            Status = request.Status,
            Priority = request.Priority,
            Progress = request.Progress,
            DueDate = request.DueDate,
            Tags = request.Tags,
            SortOrder = request.SortOrder,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await _unitOfWork.TaskItems.AddAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse<TaskItemDto>.Ok(MapToDto(item));
    }

    [HttpPut("{id:guid}")]
    public async Task<ApiResponse<TaskItemDto>> Update(Guid id, [FromBody] UpdateTaskItemRequest request, CancellationToken ct)
    {
        var item = await _unitOfWork.TaskItems.GetByIdAsync(id, ct);
        if (item is null) return ApiResponse<TaskItemDto>.Fail("任务不存在");

        item.Title = request.Title;
        item.Description = request.Description;
        item.Status = request.Status;
        item.Priority = request.Priority;
        item.Progress = request.Progress;
        item.DueDate = request.DueDate;
        item.Tags = request.Tags;
        item.SortOrder = request.SortOrder;
        item.CompletedAt = request.Status == 2 ? DateTimeOffset.UtcNow : null;
        item.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.TaskItems.UpdateAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse<TaskItemDto>.Ok(MapToDto(item));
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<ApiResponse<TaskItemDto>> UpdateStatus(Guid id, [FromBody] UpdateTaskStatusRequest request, CancellationToken ct)
    {
        var item = await _unitOfWork.TaskItems.GetByIdAsync(id, ct);
        if (item is null) return ApiResponse<TaskItemDto>.Fail("任务不存在");

        item.Status = request.Status;
        item.Progress = request.Status == 2 ? 100 : item.Progress;
        item.CompletedAt = request.Status == 2 ? DateTimeOffset.UtcNow : null;
        item.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.TaskItems.UpdateAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse<TaskItemDto>.Ok(MapToDto(item));
    }

    [HttpPatch("{id:guid}/progress")]
    public async Task<ApiResponse<TaskItemDto>> UpdateProgress(Guid id, [FromBody] UpdateTaskProgressRequest request, CancellationToken ct)
    {
        var item = await _unitOfWork.TaskItems.GetByIdAsync(id, ct);
        if (item is null) return ApiResponse<TaskItemDto>.Fail("任务不存在");

        item.Progress = Math.Clamp(request.Progress, 0, 100);
        if (item.Progress == 100 && item.Status != 2)
        {
            item.Status = 2;
            item.CompletedAt = DateTimeOffset.UtcNow;
        }
        else if (item.Progress > 0 && item.Progress < 100 && item.Status == 0)
        {
            item.Status = 1;
        }
        item.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.TaskItems.UpdateAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse<TaskItemDto>.Ok(MapToDto(item));
    }

    [HttpDelete("{id:guid}")]
    public async Task<ApiResponse> Delete(Guid id, CancellationToken ct)
    {
        var item = await _unitOfWork.TaskItems.GetByIdAsync(id, ct);
        if (item is null) return ApiResponse.Fail("任务不存在");

        item.IsDeleted = true;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.TaskItems.UpdateAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse.Ok();
    }

    [HttpGet("stats")]
    public async Task<ApiResponse<TaskStatsDto>> GetStats(CancellationToken ct)
    {
        var items = await _unitOfWork.TaskItems.GetAllAsync(ct);
        var stats = new TaskStatsDto
        {
            Total = items.Count,
            Todo = items.Count(t => t.Status == 0),
            InProgress = items.Count(t => t.Status == 1),
            Done = items.Count(t => t.Status == 2),
            Blocked = items.Count(t => t.Status == 3),
            Overdue = items.Count(t => t.DueDate.HasValue && t.DueDate.Value < DateTimeOffset.UtcNow && t.Status != 2),
        };
        return ApiResponse<TaskStatsDto>.Ok(stats);
    }

    private static TaskItemDto MapToDto(TaskItem t) => new()
    {
        Id = t.Id,
        Title = t.Title,
        Description = t.Description,
        Status = t.Status,
        Priority = t.Priority,
        Progress = t.Progress,
        DueDate = t.DueDate,
        CompletedAt = t.CompletedAt,
        Tags = t.Tags,
        SortOrder = t.SortOrder,
        CreatedAt = t.CreatedAt,
        UpdatedAt = t.UpdatedAt,
    };
}

public class TaskItemDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int Status { get; set; }
    public int Priority { get; set; }
    public int Progress { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? Tags { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateTaskItemRequest
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int Status { get; set; }
    public int Priority { get; set; }
    public int Progress { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public string? Tags { get; set; }
    public int SortOrder { get; set; }
}

public class UpdateTaskItemRequest
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int Status { get; set; }
    public int Priority { get; set; }
    public int Progress { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public string? Tags { get; set; }
    public int SortOrder { get; set; }
}

public class UpdateTaskStatusRequest
{
    public int Status { get; set; }
}

public class UpdateTaskProgressRequest
{
    public int Progress { get; set; }
}

public class TaskStatsDto
{
    public int Total { get; set; }
    public int Todo { get; set; }
    public int InProgress { get; set; }
    public int Done { get; set; }
    public int Blocked { get; set; }
    public int Overdue { get; set; }
}
