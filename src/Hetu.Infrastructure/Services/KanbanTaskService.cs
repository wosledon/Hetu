using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Tasks;

namespace Hetu.Infrastructure.Services;

public class KanbanTaskService : IKanbanTaskService
{
    /// <summary>归档列展示窗口：仅展示最近 7 天内归档的任务</summary>
    private static readonly TimeSpan ArchivedWindow = TimeSpan.FromDays(7);

    private readonly IUnitOfWork _unitOfWork;

    public KanbanTaskService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<KanbanBoardDto>> GetBoardAsync(CancellationToken cancellationToken = default)
    {
        var tasks = await _unitOfWork.KanbanTasks.FindAsync(t => !t.IsDeleted, cancellationToken);
        var now = DateTimeOffset.UtcNow;

        var board = new KanbanBoardDto
        {
            Backlog = ColumnOf(tasks, KanbanTaskStatuses.Backlog),
            Todo = ColumnOf(tasks, KanbanTaskStatuses.Todo),
            InProgress = ColumnOf(tasks, KanbanTaskStatuses.InProgress),
            InReview = ColumnOf(tasks, KanbanTaskStatuses.InReview),
            Blocked = ColumnOf(tasks, KanbanTaskStatuses.Blocked),
            Done = ColumnOf(tasks, KanbanTaskStatuses.Done),
            Archived = tasks
                .Where(t => t.Status == KanbanTaskStatuses.Archived)
                .Where(t => t.ArchivedAt != null && t.ArchivedAt >= now - ArchivedWindow)
                .OrderBy(t => t.SortOrder).ThenByDescending(t => t.ArchivedAt)
                .Select(MapToDto).ToList(),
            Stats = BuildStats(tasks, now),
        };

        return ApiResponse<KanbanBoardDto>.Ok(board);
    }

    public async Task<ApiResponse<KanbanTaskDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDto>.Fail("任务不存在");
        return ApiResponse<KanbanTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse<KanbanTaskDto>> CreateAsync(CreateKanbanTaskRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return ApiResponse<KanbanTaskDto>.Fail("任务标题不能为空");

        var status = NormalizeStatus(request.Status);
        var now = DateTimeOffset.UtcNow;
        var task = new KanbanTask
        {
            Id = Guid.NewGuid(),
            Title = request.Title.Trim(),
            Description = request.Description?.Trim(),
            Status = status,
            Priority = NormalizePriority(request.Priority),
            Assignee = request.Assignee?.Trim(),
            Tags = request.Tags?.Trim(),
            DueDate = request.DueDate,
            BlockedReason = status == KanbanTaskStatuses.Blocked ? request.BlockedReason?.Trim() : null,
            CompletedAt = status == KanbanTaskStatuses.Done ? now : null,
            ArchivedAt = status == KanbanTaskStatuses.Archived ? now : null,
            SortOrder = await NextSortOrderAsync(status, cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };

        await _unitOfWork.KanbanTasks.AddAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse<KanbanTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse<KanbanTaskDto>> UpdateAsync(Guid id, UpdateKanbanTaskRequest request, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDto>.Fail("任务不存在");

        if (string.IsNullOrWhiteSpace(request.Title))
            return ApiResponse<KanbanTaskDto>.Fail("任务标题不能为空");

        var status = NormalizeStatus(request.Status);
        task.Title = request.Title.Trim();
        task.Description = request.Description?.Trim();
        task.Status = status;
        task.Priority = NormalizePriority(request.Priority);
        task.Assignee = request.Assignee?.Trim();
        task.Tags = request.Tags?.Trim();
        task.DueDate = request.DueDate;
        task.BlockedReason = status == KanbanTaskStatuses.Blocked
            ? (request.BlockedReason?.Trim() ?? task.BlockedReason)
            : null;
        ApplyStatusTimestamps(task, status);
        task.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.KanbanTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse<KanbanTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse<KanbanTaskDto>> MoveAsync(Guid id, MoveKanbanTaskRequest request, CancellationToken cancellationToken = default)
    {
        var targetStatus = NormalizeStatus(request.Status);

        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDto>.Fail("任务不存在");

        if (task.Status != targetStatus && !KanbanTaskTransitions.IsAllowed(task.Status, targetStatus))
            return ApiResponse<KanbanTaskDto>.Fail($"不允许从「{StatusLabel(task.Status)}」流转到「{StatusLabel(targetStatus)}」");

        var sameColumn = task.Status == targetStatus;
        task.Status = targetStatus;
        if (targetStatus == KanbanTaskStatuses.Blocked)
            task.BlockedReason = request.BlockedReason?.Trim() ?? task.BlockedReason;
        else
            task.BlockedReason = null;
        ApplyStatusTimestamps(task, targetStatus);
        task.UpdatedAt = DateTimeOffset.UtcNow;

        await ReorderColumnAsync(task, request.BeforeTaskId, sameColumn, cancellationToken);

        await _unitOfWork.KanbanTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 预留：自动化规则钩子（如到期提醒、自动归档、流转通知）稍后实现
        return ApiResponse<KanbanTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse.Fail("任务不存在");

        task.IsDeleted = true;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.KanbanTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse.Ok();
    }

    /// <summary>状态迁移时维护完成/归档时间戳</summary>
    private static void ApplyStatusTimestamps(KanbanTask task, string status)
    {
        var now = DateTimeOffset.UtcNow;
        if (status == KanbanTaskStatuses.Done && task.CompletedAt == null)
            task.CompletedAt = now;
        else if (status != KanbanTaskStatuses.Done)
            task.CompletedAt = null;

        if (status == KanbanTaskStatuses.Archived)
            task.ArchivedAt ??= now;
        else if (status != KanbanTaskStatuses.Archived)
            task.ArchivedAt = null;
    }

    /// <summary>把任务在列内移动到 BeforeTaskId 之前；列内其余任务顺延</summary>
    private async Task ReorderColumnAsync(KanbanTask task, Guid? beforeTaskId, bool sameColumn, CancellationToken cancellationToken)
    {
        var column = await _unitOfWork.KanbanTasks.FindAsync(
            t => !t.IsDeleted && t.Status == task.Status, cancellationToken);

        var ordered = column
            .Where(t => t.Id != task.Id)
            .OrderBy(t => t.SortOrder).ThenBy(t => t.CreatedAt)
            .ToList();

        var insertAt = ordered.Count;
        if (beforeTaskId != null && beforeTaskId != Guid.Empty)
        {
            var idx = ordered.FindIndex(t => t.Id == beforeTaskId.Value);
            if (idx >= 0) insertAt = idx;
        }

        ordered.Insert(insertAt, task);

        for (var i = 0; i < ordered.Count; i++)
        {
            var item = ordered[i];
            if (item.Id == task.Id) continue;
            if (item.SortOrder == i) continue;
            item.SortOrder = i;
            item.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.KanbanTasks.UpdateAsync(item, cancellationToken);
        }

        task.SortOrder = insertAt;
    }

    private async Task<int> NextSortOrderAsync(string status, CancellationToken cancellationToken)
    {
        var column = await _unitOfWork.KanbanTasks.FindAsync(
            t => !t.IsDeleted && t.Status == status, cancellationToken);
        return column.Count == 0 ? 0 : column.Max(t => t.SortOrder) + 1;
    }

    private static List<KanbanTaskDto> ColumnOf(IReadOnlyList<KanbanTask> tasks, string status) => tasks
        .Where(t => t.Status == status)
        .OrderBy(t => t.SortOrder).ThenBy(t => t.CreatedAt)
        .Select(MapToDto)
        .ToList();

    private static KanbanTaskStatsDto BuildStats(IReadOnlyList<KanbanTask> tasks, DateTimeOffset now)
    {
        var active = tasks.Where(t => t.Status is not (KanbanTaskStatuses.Archived));
        return new KanbanTaskStatsDto
        {
            Total = tasks.Count,
            Active = active.Count(),
            Done = tasks.Count(t => t.Status == KanbanTaskStatuses.Done),
            Archived = tasks.Count(t => t.Status == KanbanTaskStatuses.Archived),
            Overdue = active.Count(t => t.DueDate != null && t.DueDate < now && t.Status != KanbanTaskStatuses.Done),
            DueSoon = active.Count(t => t.DueDate != null && t.DueDate >= now && t.DueDate <= now.AddDays(3)),
        };
    }

    private static string NormalizeStatus(string status) =>
        KanbanTaskStatuses.All.Contains(status) ? status : KanbanTaskStatuses.Backlog;

    private static string NormalizePriority(string priority) =>
        KanbanTaskPriorities.All.Contains(priority) ? priority : KanbanTaskPriorities.Medium;

    private static string StatusLabel(string status) => status switch
    {
        KanbanTaskStatuses.Backlog => "待规划",
        KanbanTaskStatuses.Todo => "待办",
        KanbanTaskStatuses.InProgress => "进行中",
        KanbanTaskStatuses.InReview => "审核中",
        KanbanTaskStatuses.Blocked => "已阻塞",
        KanbanTaskStatuses.Done => "已完成",
        KanbanTaskStatuses.Archived => "已归档",
        _ => status,
    };

    private static KanbanTaskDto MapToDto(KanbanTask t) => new()
    {
        Id = t.Id,
        Title = t.Title,
        Description = t.Description,
        Status = t.Status,
        Priority = t.Priority,
        Assignee = t.Assignee,
        Tags = t.Tags,
        DueDate = t.DueDate,
        SortOrder = t.SortOrder,
        BlockedReason = t.BlockedReason,
        CompletedAt = t.CompletedAt,
        ArchivedAt = t.ArchivedAt,
        CreatedAt = t.CreatedAt,
        UpdatedAt = t.UpdatedAt,
    };
}
