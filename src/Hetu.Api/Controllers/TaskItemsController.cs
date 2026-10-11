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
    private readonly ILocalizer _localizer;

    public TaskItemsController(IUnitOfWork unitOfWork, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
    }

    [HttpGet]
    public async Task<ApiResponse<List<TaskItemDto>>> GetAll([FromQuery] string? type, [FromQuery] int? status, CancellationToken ct)
    {
        // 过滤条件下推到数据库，避免全表加载
        var typeFilter = string.IsNullOrEmpty(type) ? null : type.ToLowerInvariant();
        // 排序 + 取前 200 条在数据库完成（SQLite 下由仓储投影排序键定序），不再把整张任务表读进内存
        var items = await _unitOfWork.TaskItems.GetPagedByDateAsync(
            t => (typeFilter == null || t.TaskType.ToLower() == typeFilter) && (status == null || t.Status == status),
            t => t.CreatedAt,
            descending: true,
            skip: 0,
            take: 200,
            ct);

        var dtos = items.Select(MapToDto).ToList();
        return ApiResponse<List<TaskItemDto>>.Ok(dtos);
    }

    [HttpGet("stats")]
    public async Task<ApiResponse<TaskStatsDto>> GetStats(CancellationToken ct)
    {
        // 各状态计数走 SQL COUNT：任务表会随后台任务持续增长，不再整表加载
        var tasks = _unitOfWork.TaskItems;
        var since = DateTimeOffset.UtcNow.AddHours(-24);
        // SQLite 不支持在 SQL 中比较 DateTimeOffset：失败任务很少，只取失败任务的时间戳在内存计数
        var failedAt = await tasks.SelectAsync(t => t.Status == 3, t => t.CreatedAt, ct);
        var stats = new TaskStatsDto
        {
            Total = await tasks.CountAsync(cancellationToken: ct),
            Queued = await tasks.CountAsync(t => t.Status == 0, ct),
            Running = await tasks.CountAsync(t => t.Status == 1, ct),
            Completed = await tasks.CountAsync(t => t.Status == 2, ct),
            Failed = failedAt.Count,
            RecentFailed = failedAt.Count(at => at > since),
        };
        return ApiResponse<TaskStatsDto>.Ok(stats);
    }

    [HttpDelete("{id:guid}")]
    public async Task<ApiResponse> Delete(Guid id, CancellationToken ct)
    {
        var item = await _unitOfWork.TaskItems.GetByIdAsync(id, ct);
        if (item is null) return ApiResponse.Fail(_localizer.T("taskItems.notFound"));

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
