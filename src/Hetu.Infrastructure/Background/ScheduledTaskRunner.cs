using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 定时任务调度器：每 30 秒扫描到期任务并执行，记录历史与重试
/// </summary>
public class ScheduledTaskRunner : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ScheduledTaskRunner> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);

    public ScheduledTaskRunner(IServiceScopeFactory scopeFactory, ILogger<ScheduledTaskRunner> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("定时任务调度器已启动");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "定时任务调度周期出错");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("定时任务调度器已停止");
    }

    private async Task TickAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var scheduledTaskService = scope.ServiceProvider.GetRequiredService<IScheduledTaskService>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
        var executors = scope.ServiceProvider.GetRequiredService<IEnumerable<IScheduledTaskExecutor>>()
            .ToDictionary(e => e.Kind);

        var dueTasks = await scheduledTaskService.GetDueTasksAsync(cancellationToken);
        if (dueTasks.Count == 0) return;

        _logger.LogDebug("发现 {Count} 个到期定时任务", dueTasks.Count);

        foreach (var task in dueTasks)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await ExecuteTaskAsync(task, executors, unitOfWork, scheduledTaskService, cancellationToken);
        }
    }

    private async Task ExecuteTaskAsync(
        ScheduledTask task,
        Dictionary<string, IScheduledTaskExecutor> executors,
        IUnitOfWork unitOfWork,
        IScheduledTaskService scheduledTaskService,
        CancellationToken cancellationToken)
    {
        // 标记为执行中，避免重复拾取
        var now = DateTimeOffset.UtcNow;
        task.LastStatus = "Running";
        task.LastRunAt = now;
        task.NextRunAt = null;
        task.UpdatedAt = now;
        await unitOfWork.ScheduledTasks.UpdateAsync(task, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        // 记录执行历史
        var execution = new ScheduledTaskExecution
        {
            Id = Guid.NewGuid(),
            ScheduledTaskId = task.Id,
            StartedAt = now,
            Status = "Running",
            RetryAttempt = task.RetryCount,
            IsManual = false,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await unitOfWork.ScheduledTaskExecutions.AddAsync(execution, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        var succeeded = false;
        string? errorMessage = null;
        string? resultSummary = null;

        try
        {
            if (!executors.TryGetValue(task.TaskKind, out var executor))
                throw new InvalidOperationException($"未找到任务种类 {task.TaskKind} 的执行器");

            resultSummary = await executor.ExecuteAsync(task, cancellationToken);
            succeeded = true;
        }
        catch (OperationCanceledException)
        {
            errorMessage = "任务被取消";
            throw;
        }
        catch (Exception ex)
        {
            errorMessage = ex.Message;
            _logger.LogError(ex, "定时任务 {TaskId}({TaskName}) 执行失败", task.Id, task.Name);
        }

        var completedAt = DateTimeOffset.UtcNow;
        execution.CompletedAt = completedAt;
        execution.Status = succeeded ? "Success" : "Failed";
        execution.ErrorMessage = errorMessage;
        execution.Result = succeeded ? resultSummary : null;
        execution.UpdatedAt = completedAt;
        await unitOfWork.ScheduledTaskExecutions.UpdateAsync(execution, cancellationToken);

        // 更新任务状态与下次运行
        task.LastStatus = succeeded ? "Success" : "Failed";
        task.LastError = succeeded ? null : errorMessage;
        task.UpdatedAt = completedAt;

        if (succeeded)
        {
            task.RetryCount = 0;
            task.NextRunAt = task.IsEnabled ? scheduledTaskService.CalculateNextRun(task) : null;
        }
        else
        {
            // 重试逻辑：未达最大重试次数则短期内重试，否则放弃并排到下一周期
            if (task.RetryCount < task.MaxRetries)
            {
                task.RetryCount++;
                // 指数退避：1min、2min、4min...
                var backoff = TimeSpan.FromMinutes(Math.Pow(2, task.RetryCount - 1));
                task.NextRunAt = completedAt + backoff;
                _logger.LogInformation("定时任务 {TaskId} 将在 {Backoff} 后重试（第 {Retry} 次）", task.Id, backoff, task.RetryCount);
            }
            else
            {
                task.RetryCount = 0;
                task.NextRunAt = task.IsEnabled ? scheduledTaskService.CalculateNextRun(task) : null;
            }
        }

        await unitOfWork.ScheduledTasks.UpdateAsync(task, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}
