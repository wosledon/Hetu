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
    private readonly IKanbanTaskExecutor _executor;

    public KanbanTaskService(IUnitOfWork unitOfWork, IKanbanTaskExecutor executor)
    {
        _unitOfWork = unitOfWork;
        _executor = executor;
    }

    public async Task<ApiResponse<KanbanBoardDto>> GetBoardAsync(CancellationToken cancellationToken = default)
    {
        var tasks = await _unitOfWork.KanbanTasks.FindAsync(t => !t.IsDeleted, cancellationToken);
        var now = DateTimeOffset.UtcNow;

        var board = new KanbanBoardDto
        {
            Backlog = await EnrichAsync(ColumnEntitiesOf(tasks, KanbanTaskStatuses.Backlog), cancellationToken),
            Todo = await EnrichAsync(ColumnEntitiesOf(tasks, KanbanTaskStatuses.Todo), cancellationToken),
            InProgress = await EnrichAsync(ColumnEntitiesOf(tasks, KanbanTaskStatuses.InProgress), cancellationToken),
            InReview = await EnrichAsync(ColumnEntitiesOf(tasks, KanbanTaskStatuses.InReview), cancellationToken),
            Blocked = await EnrichAsync(ColumnEntitiesOf(tasks, KanbanTaskStatuses.Blocked), cancellationToken),
            Done = await EnrichAsync(ColumnEntitiesOf(tasks, KanbanTaskStatuses.Done), cancellationToken),
            Archived = await EnrichAsync(tasks
                .Where(t => t.Status == KanbanTaskStatuses.Archived)
                .Where(t => t.ArchivedAt != null && t.ArchivedAt >= now - ArchivedWindow)
                .OrderBy(t => t.SortOrder).ThenByDescending(t => t.ArchivedAt)
                .ToList(), cancellationToken),
            Stats = BuildStats(tasks, now),
        };

        return ApiResponse<KanbanBoardDto>.Ok(board);
    }

    public async Task<ApiResponse<KanbanTaskDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDto>.Fail("任务不存在");
        return ApiResponse<KanbanTaskDto>.Ok(await EnrichDtoAsync(task, cancellationToken));
    }

    /// <summary>批量回填：一次加载字典，避免 N+1 查询</summary>
    private async Task<List<KanbanTaskDto>> EnrichAsync(List<KanbanTask> tasks, CancellationToken cancellationToken)
    {
        if (tasks.Count == 0) return [];

        var projectIds = tasks.Where(t => t.ProjectId != null).Select(t => t.ProjectId!.Value).Distinct().ToList();
        var agentIds = tasks.Where(t => t.AgentId != null).Select(t => t.AgentId!.Value).Distinct().ToList();
        var workflowIds = tasks.Where(t => t.WorkflowId != null).Select(t => t.WorkflowId!.Value).Distinct().ToList();
        var runIds = tasks.Where(t => t.LastRunId != null).Select(t => t.LastRunId!.Value).Distinct().ToList();
        var taskIds = tasks.Select(t => t.Id).ToList();

        var projectNames = projectIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken))
                .Where(p => projectIds.Contains(p.Id)).ToDictionary(p => p.Id, p => p.Name);
        var agentNames = agentIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _unitOfWork.PromptPresets.GetAllAsync(cancellationToken))
                .Where(p => agentIds.Contains(p.Id)).ToDictionary(p => p.Id, p => p.Name);
        var workflowNames = workflowIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _unitOfWork.Workflows.GetAllAsync(cancellationToken))
                .Where(w => workflowIds.Contains(w.Id)).ToDictionary(w => w.Id, w => w.Name);
        var runStatuses = runIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _unitOfWork.KanbanTaskRuns.GetAllAsync(cancellationToken))
                .Where(r => runIds.Contains(r.Id)).ToDictionary(r => r.Id, r => r.Status);
        var commentCounts = (await _unitOfWork.KanbanTaskComments.GetAllAsync(cancellationToken))
            .Where(c => !c.IsDeleted && taskIds.Contains(c.TaskId))
            .GroupBy(c => c.TaskId).ToDictionary(g => g.Key, g => g.Count());

        return tasks.Select(t =>
        {
            var dto = MapToDto(t);
            if (t.ProjectId != null) dto.ProjectName = projectNames.GetValueOrDefault(t.ProjectId.Value);
            if (t.AgentId != null) dto.AgentName = agentNames.GetValueOrDefault(t.AgentId.Value);
            if (t.WorkflowId != null) dto.WorkflowName = workflowNames.GetValueOrDefault(t.WorkflowId.Value);
            if (t.LastRunId != null) dto.LastRunStatus = runStatuses.GetValueOrDefault(t.LastRunId.Value);
            dto.CommentCount = commentCounts.GetValueOrDefault(t.Id);
            return dto;
        }).ToList();
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
            ProjectId = request.ProjectId,
            AgentId = request.AgentId,
            WorkflowId = request.WorkflowId,
            SortOrder = await NextSortOrderAsync(status, cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };

        await _unitOfWork.KanbanTasks.AddAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await TriggerAutomationAsync(task, "Todo", cancellationToken);

        return ApiResponse<KanbanTaskDto>.Ok(await EnrichDtoAsync(task, cancellationToken));
    }

    public async Task<ApiResponse<KanbanTaskDto>> UpdateAsync(Guid id, UpdateKanbanTaskRequest request, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDto>.Fail("任务不存在");

        if (string.IsNullOrWhiteSpace(request.Title))
            return ApiResponse<KanbanTaskDto>.Fail("任务标题不能为空");

        var status = NormalizeStatus(request.Status);
        var statusChanged = task.Status != status;
        task.Title = request.Title.Trim();
        task.Description = request.Description?.Trim();
        task.Status = status;
        task.Priority = NormalizePriority(request.Priority);
        task.Assignee = request.Assignee?.Trim();
        task.Tags = request.Tags?.Trim();
        task.DueDate = request.DueDate;
        task.ProjectId = request.ProjectId;
        task.AgentId = request.AgentId;
        task.WorkflowId = request.WorkflowId;
        task.BlockedReason = status == KanbanTaskStatuses.Blocked
            ? (request.BlockedReason?.Trim() ?? task.BlockedReason)
            : null;
        ApplyStatusTimestamps(task, status);
        task.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.KanbanTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        if (statusChanged) await TriggerAutomationAsync(task, "Todo", cancellationToken);

        return ApiResponse<KanbanTaskDto>.Ok(await EnrichDtoAsync(task, cancellationToken));
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

        // 进入待办即触发自动处理（仅配置了智能体/工作流时）
        await TriggerAutomationAsync(task, "Todo", cancellationToken);

        return ApiResponse<KanbanTaskDto>.Ok(await EnrichDtoAsync(task, cancellationToken));
    }

    public async Task<ApiResponse<KanbanTaskDetailDto>> GetDetailAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDetailDto>.Fail("任务不存在");

        var comments = await _unitOfWork.KanbanTaskComments.FindAsync(c => c.TaskId == id, cancellationToken);
        var runs = await _unitOfWork.KanbanTaskRuns.FindAsync(r => r.TaskId == id, cancellationToken);

        return ApiResponse<KanbanTaskDetailDto>.Ok(new KanbanTaskDetailDto
        {
            Task = await EnrichDtoAsync(task, cancellationToken),
            Comments = comments
                .Where(c => !c.IsDeleted)
                .OrderBy(c => c.CreatedAt)
                .Select(MapComment).ToList(),
            Runs = runs
                .OrderByDescending(r => r.CreatedAt)
                .Select(MapRun).ToList(),
        });
    }

    public async Task<ApiResponse<KanbanTaskDetailDto>> AddCommentAsync(
        Guid id, CreateKanbanTaskCommentRequest request, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDetailDto>.Fail("任务不存在");

        var content = request.Content?.Trim();
        if (string.IsNullOrWhiteSpace(content)) return ApiResponse<KanbanTaskDetailDto>.Fail("评论内容不能为空");

        var now = DateTimeOffset.UtcNow;
        await _unitOfWork.KanbanTaskComments.AddAsync(new KanbanTaskComment
        {
            Id = Guid.NewGuid(),
            TaskId = id,
            AuthorType = "User",
            AuthorName = "我",
            Content = content,
            CreatedAt = now,
            UpdatedAt = now,
        }, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 用户在审核中/已阻塞下提交评论：任务回到进行中，由智能体根据评论继续处理
        var needsRework = request.TriggerAutomation
            && (task.AgentId != null || task.WorkflowId != null)
            && task.Status is KanbanTaskStatuses.InReview or KanbanTaskStatuses.Blocked;
        if (needsRework)
        {
            task.Status = KanbanTaskStatuses.InProgress;
            task.BlockedReason = null;
            task.CompletedAt = null;
            task.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.KanbanTasks.UpdateAsync(task, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            await _executor.TriggerAsync(id, "Comment", cancellationToken);
        }

        return await GetDetailAsync(id, cancellationToken);
    }

    public async Task<ApiResponse<KanbanTaskDto>> RerunAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(id, cancellationToken);
        if (task == null || task.IsDeleted) return ApiResponse<KanbanTaskDto>.Fail("任务不存在");
        if (task.Status != KanbanTaskStatuses.Todo)
            return ApiResponse<KanbanTaskDto>.Fail("仅待办状态的任务可以重新执行");

        await TriggerAutomationAsync(task, "Manual", cancellationToken);
        return ApiResponse<KanbanTaskDto>.Ok(await EnrichDtoAsync(task, cancellationToken));
    }

    /// <summary>
    /// 进入待办（或手动重跑）时触发自动处理：只对配置了智能体/工作流的任务生效。
    /// trigger 仅用于执行记录的来源标记，状态为待办时由执行器流转到进行中。
    /// </summary>
    private async Task TriggerAutomationAsync(KanbanTask task, string trigger, CancellationToken cancellationToken)
    {
        if (task.IsDeleted || task.Status != KanbanTaskStatuses.Todo) return;
        await _executor.TriggerAsync(task.Id, trigger, cancellationToken);
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

    private static List<KanbanTask> ColumnEntitiesOf(IReadOnlyList<KanbanTask> tasks, string status) => tasks
        .Where(t => t.Status == status)
        .OrderBy(t => t.SortOrder).ThenBy(t => t.CreatedAt)
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
        ProjectId = t.ProjectId,
        AgentId = t.AgentId,
        WorkflowId = t.WorkflowId,
        LastRunId = t.LastRunId,
        CreatedAt = t.CreatedAt,
        UpdatedAt = t.UpdatedAt,
    };

    private static KanbanTaskCommentDto MapComment(KanbanTaskComment c) => new()
    {
        Id = c.Id,
        TaskId = c.TaskId,
        AuthorType = c.AuthorType,
        AuthorName = c.AuthorName,
        Content = c.Content,
        RunId = c.RunId,
        CreatedAt = c.CreatedAt,
    };

    private static KanbanTaskRunDto MapRun(KanbanTaskRun r) => new()
    {
        Id = r.Id,
        TaskId = r.TaskId,
        Kind = r.Kind,
        Trigger = r.Trigger,
        Status = r.Status,
        Output = r.Output,
        Error = r.Error,
        WorkflowRunId = r.WorkflowRunId,
        StartedAt = r.StartedAt,
        CompletedAt = r.CompletedAt,
        CreatedAt = r.CreatedAt,
    };

    /// <summary>回填项目/智能体/工作流名称、最近执行状态与评论数</summary>
    private async Task<KanbanTaskDto> EnrichDtoAsync(KanbanTask task, CancellationToken cancellationToken)
    {
        var dto = MapToDto(task);

        if (task.ProjectId != null)
        {
            var project = await _unitOfWork.ManagedProjects.GetByIdAsync(task.ProjectId.Value, cancellationToken);
            dto.ProjectName = project?.Name;
        }
        if (task.AgentId != null)
        {
            var agent = await _unitOfWork.PromptPresets.GetByIdAsync(task.AgentId.Value, cancellationToken);
            dto.AgentName = agent?.Name;
        }
        if (task.WorkflowId != null)
        {
            var workflow = await _unitOfWork.Workflows.GetByIdAsync(task.WorkflowId.Value, cancellationToken);
            dto.WorkflowName = workflow?.Name;
        }
        if (task.LastRunId != null)
        {
            var run = await _unitOfWork.KanbanTaskRuns.GetByIdAsync(task.LastRunId.Value, cancellationToken);
            dto.LastRunStatus = run?.Status;
        }

        var comments = await _unitOfWork.KanbanTaskComments.FindAsync(c => c.TaskId == task.Id, cancellationToken);
        dto.CommentCount = comments.Count(c => !c.IsDeleted);
        return dto;
    }
}
