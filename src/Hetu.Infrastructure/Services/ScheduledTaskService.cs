using Cronos;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Hetu.Shared.Tasks;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Services;

public class ScheduledTaskService : IScheduledTaskService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ISkillService _skillService;
    private readonly ILocalSkillService _localSkillService;
    private readonly ILogger<ScheduledTaskService> _logger;

    public ScheduledTaskService(
        IUnitOfWork unitOfWork,
        ISkillService skillService,
        ILocalSkillService localSkillService,
        ILogger<ScheduledTaskService> logger)
    {
        _unitOfWork = unitOfWork;
        _skillService = skillService;
        _localSkillService = localSkillService;
        _logger = logger;
    }

    public async Task<ApiResponse<List<ScheduledTaskDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var items = await _unitOfWork.ScheduledTasks.GetAllAsync(cancellationToken);
        var dtos = items
            .OrderByDescending(t => t.CreatedAt)
            .Select(MapToDto)
            .ToList();
        return ApiResponse<List<ScheduledTaskDto>>.Ok(dtos);
    }

    public async Task<ApiResponse<ScheduledTaskDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.ScheduledTasks.GetByIdAsync(id, cancellationToken);
        if (task is null) return ApiResponse<ScheduledTaskDto>.Fail("定时任务不存在");
        return ApiResponse<ScheduledTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse<ScheduledTaskDto>> CreateAsync(CreateScheduledTaskRequest request, CancellationToken cancellationToken = default)
    {
        var error = ValidateRequest(request);
        if (error != null) return ApiResponse<ScheduledTaskDto>.Fail(error);

        var now = DateTimeOffset.UtcNow;
        var task = new ScheduledTask
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description?.Trim(),
            TaskKind = request.TaskKind,
            TargetId = request.TargetId,
            TargetName = request.TargetName,
            Parameters = request.Parameters,
            ScheduleType = request.ScheduleType,
            IntervalMinutes = request.IntervalMinutes,
            CronExpression = request.CronExpression?.Trim(),
            IsEnabled = request.IsEnabled,
            MaxRetries = Math.Max(0, request.MaxRetries),
            RetryCount = 0,
            TopicId = request.TopicId,
            CreatedAt = now,
            UpdatedAt = now,
        };

        task.NextRunAt = task.IsEnabled ? CalculateNextRun(task) : null;

        await _unitOfWork.ScheduledTasks.AddAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ScheduledTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse<ScheduledTaskDto>> UpdateAsync(Guid id, UpdateScheduledTaskRequest request, CancellationToken cancellationToken = default)
    {
        var error = ValidateRequest(request);
        if (error != null) return ApiResponse<ScheduledTaskDto>.Fail(error);

        var task = await _unitOfWork.ScheduledTasks.GetByIdAsync(id, cancellationToken);
        if (task is null) return ApiResponse<ScheduledTaskDto>.Fail("定时任务不存在");

        task.Name = request.Name.Trim();
        task.Description = request.Description?.Trim();
        task.TaskKind = request.TaskKind;
        task.TargetId = request.TargetId;
        task.TargetName = request.TargetName;
        task.Parameters = request.Parameters;
        task.ScheduleType = request.ScheduleType;
        task.IntervalMinutes = request.IntervalMinutes;
        task.CronExpression = request.CronExpression?.Trim();
        task.IsEnabled = request.IsEnabled;
        task.MaxRetries = Math.Max(0, request.MaxRetries);
        task.TopicId = request.TopicId;
        task.UpdatedAt = DateTimeOffset.UtcNow;

        // 调度变更后重新计算下次运行；重试计数在配置变更时归零
        task.RetryCount = 0;
        task.NextRunAt = task.IsEnabled ? CalculateNextRun(task) : null;

        await _unitOfWork.ScheduledTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ScheduledTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.ScheduledTasks.GetByIdAsync(id, cancellationToken);
        if (task is null) return ApiResponse.Fail("定时任务不存在");

        task.IsDeleted = true;
        task.IsEnabled = false;
        task.NextRunAt = null;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.ScheduledTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<ScheduledTaskDto>> ToggleAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.ScheduledTasks.GetByIdAsync(id, cancellationToken);
        if (task is null) return ApiResponse<ScheduledTaskDto>.Fail("定时任务不存在");

        task.IsEnabled = !task.IsEnabled;
        task.RetryCount = 0;
        task.NextRunAt = task.IsEnabled ? CalculateNextRun(task) : null;
        task.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.ScheduledTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ScheduledTaskDto>.Ok(MapToDto(task));
    }

    public async Task<ApiResponse<ScheduledTaskExecutionDto>> RunNowAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.ScheduledTasks.GetByIdAsync(id, cancellationToken);
        if (task is null) return ApiResponse<ScheduledTaskExecutionDto>.Fail("定时任务不存在");

        // 立即触发：把 NextRunAt 置为当下，由 Runner 拾取执行
        task.NextRunAt = DateTimeOffset.UtcNow;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.ScheduledTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 返回一条占位的执行记录，前端可据此跳转历史
        var placeholder = new ScheduledTaskExecutionDto
        {
            Id = Guid.Empty,
            ScheduledTaskId = task.Id,
            StartedAt = DateTimeOffset.UtcNow,
            Status = "Queued",
            IsManual = true,
        };
        return ApiResponse<ScheduledTaskExecutionDto>.Ok(placeholder);
    }

    public async Task<ApiResponse<List<ScheduledTaskExecutionDto>>> GetExecutionsAsync(Guid id, int limit = 50, CancellationToken cancellationToken = default)
    {
        var executions = await _unitOfWork.ScheduledTaskExecutions.FindAsync(
            e => e.ScheduledTaskId == id, cancellationToken);
        var dtos = executions
            .OrderByDescending(e => e.StartedAt)
            .Take(limit)
            .Select(MapExecutionToDto)
            .ToList();
        return ApiResponse<List<ScheduledTaskExecutionDto>>.Ok(dtos);
    }

    public async Task<ApiResponse<ScheduledTaskTargetOptionsDto>> GetTargetOptionsAsync(CancellationToken cancellationToken = default)
    {
        var skillsResp = await _skillService.GetAllAsync(cancellationToken);
        var skills = skillsResp.Data ?? new List<SkillDto>();

        var dto = new ScheduledTaskTargetOptionsDto
        {
            Skills = skills
                .Where(s => s.IsEnabled)
                .Select(s => new ScheduledTaskTargetOption
                {
                    Value = s.Id.ToString(),
                    Label = s.Name,
                    Description = s.Description,
                    Source = "database",
                })
                .ToList(),
        };

        try
        {
            var localResp = await _localSkillService.ScanAllAsync(cancellationToken);
            var localSkills = localResp.Data ?? new List<LocalSkillDto>();
            dto.LocalSkills = localSkills
                .Where(s => s.IsEnabled)
                .Select(s => new ScheduledTaskTargetOption
                {
                    Value = s.Id,
                    Label = s.Name,
                    Description = s.Description,
                    Source = "local",
                })
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "加载本地技能失败");
        }

        return ApiResponse<ScheduledTaskTargetOptionsDto>.Ok(dto);
    }

    public DateTimeOffset? CalculateNextRun(ScheduledTask task)
    {
        var now = DateTimeOffset.UtcNow;
        try
        {
            if (task.ScheduleType == ScheduleTypes.Cron)
            {
                if (string.IsNullOrWhiteSpace(task.CronExpression)) return null;
                var expr = CronExpression.Parse(task.CronExpression);
                var next = expr.GetNextOccurrence(now, TimeZoneInfo.Utc);
                return next;
            }
            else // Interval
            {
                var minutes = task.IntervalMinutes <= 0 ? 60 : task.IntervalMinutes;
                var baseTime = task.LastRunAt ?? now;
                var next = baseTime.AddMinutes(minutes);
                return next <= now ? now.AddMinutes(minutes) : next;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "计算定时任务 {Id} 下次运行时间失败", task.Id);
            return null;
        }
    }

    public async Task<List<ScheduledTask>> GetDueTasksAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var all = await _unitOfWork.ScheduledTasks.GetAllAsync(cancellationToken);
        return all
            .Where(t => t.IsEnabled && t.NextRunAt.HasValue && t.NextRunAt.Value <= now)
            .ToList();
    }

    private static string? ValidateRequest(CreateScheduledTaskRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return "任务名称不能为空";
        if (!ScheduledTaskKinds.All.Contains(request.TaskKind)) return $"不支持的任务种类: {request.TaskKind}";
        if (request.ScheduleType == ScheduleTypes.Cron && string.IsNullOrWhiteSpace(request.CronExpression))
            return "Cron 调度必须提供 Cron 表达式";
        if (request.ScheduleType == ScheduleTypes.Interval && request.IntervalMinutes <= 0)
            return "间隔调度必须提供大于 0 的间隔分钟数";
        if (request.TaskKind == ScheduledTaskKinds.Skill && string.IsNullOrWhiteSpace(request.TargetId))
            return "执行 Skill 任务必须选择目标技能";
        if (request.TaskKind == ScheduledTaskKinds.AiTask && string.IsNullOrWhiteSpace(request.Parameters))
            return "AI 任务必须提供任务指令";
        return null;
    }

    private static ScheduledTaskDto MapToDto(ScheduledTask t) => new()
    {
        Id = t.Id,
        Name = t.Name,
        Description = t.Description,
        TaskKind = t.TaskKind,
        TargetId = t.TargetId,
        TargetName = t.TargetName,
        Parameters = t.Parameters,
        ScheduleType = t.ScheduleType,
        IntervalMinutes = t.IntervalMinutes,
        CronExpression = t.CronExpression,
        IsEnabled = t.IsEnabled,
        NextRunAt = t.NextRunAt,
        LastRunAt = t.LastRunAt,
        LastStatus = t.LastStatus,
        LastError = t.LastError,
        MaxRetries = t.MaxRetries,
        RetryCount = t.RetryCount,
        TopicId = t.TopicId,
        CreatedAt = t.CreatedAt,
        UpdatedAt = t.UpdatedAt,
    };

    private static ScheduledTaskExecutionDto MapExecutionToDto(ScheduledTaskExecution e) => new()
    {
        Id = e.Id,
        ScheduledTaskId = e.ScheduledTaskId,
        StartedAt = e.StartedAt,
        CompletedAt = e.CompletedAt,
        Status = e.Status,
        ErrorMessage = e.ErrorMessage,
        Result = e.Result,
        RetryAttempt = e.RetryAttempt,
        IsManual = e.IsManual,
        DurationMs = e.CompletedAt.HasValue
            ? (long)(e.CompletedAt.Value - e.StartedAt).TotalMilliseconds
            : null,
    };
}
