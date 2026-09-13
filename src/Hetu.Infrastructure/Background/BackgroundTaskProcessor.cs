using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 后台任务处理器：从 Channel 消费工作项并执行，同时记录状态到 DB
/// </summary>
public class BackgroundTaskProcessor : BackgroundService
{
    /// <summary>运行期巡检间隔</summary>
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(2);

    /// <summary>巡检只恢复超过该时长未更新的记录，避免与正在排队/执行的任务冲突</summary>
    private static readonly TimeSpan StaleThreshold = TimeSpan.FromMinutes(5);

    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<BackgroundTaskProcessor> _logger;

    public BackgroundTaskProcessor(
        IBackgroundTaskQueue taskQueue,
        IServiceScopeFactory scopeFactory,
        ILogger<BackgroundTaskProcessor> logger)
    {
        _taskQueue = taskQueue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("后台任务处理器已启动");

        // 队列在内存中，进程重启后遗留的 Queued/Running 记录不会有人消费，必须补入队
        // 必须与消费循环并行：通道有容量上限，先灌满再消费会互相等待造成死锁
        _ = Task.Run(() => RecoverPendingTasksAsync(null, stoppingToken), CancellationToken.None);

        // 运行期巡检：补投进程存活期间丢失或长期卡住的任务（例如入队后进程被强杀的场景之外的中断）
        _ = Task.Run(() => SweepLoopAsync(stoppingToken), CancellationToken.None);

        while (!stoppingToken.IsCancellationRequested)
        {
            BackgroundWorkItem item;
            try
            {
                item = await _taskQueue.DequeueAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<HetuDbContext>();
            var coordinator = scope.ServiceProvider.GetRequiredService<IBackgroundTaskCoordinator>();

            TaskItem record;
            try
            {
                // 与入队共用同一把锁，保证不会与并发入队各自建出一条记录
                record = await coordinator.ClaimAsync(item.Type, item.EntityId, item.Metadata, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "后台任务 {TaskType}({EntityId}) 领取失败，交由巡检重试", item.Type, item.EntityId);
                _taskQueue.MarkFinished(item.Type, item.EntityId);
                continue;
            }

            try
            {
                await ProcessItemAsync(item, scope.ServiceProvider, stoppingToken);
                record.Status = 2; // Completed
                _logger.LogDebug("后台任务 {TaskType}({EntityId}) 完成", item.Type, item.EntityId);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // 服务停止导致的取消不算失败：重新排队，下次启动或巡检继续执行
                record.Status = 0; // Queued
                record.StartedAt = null;
                record.ErrorMessage = "服务停止，任务已重新排队";
                _logger.LogInformation("后台任务 {TaskType}({EntityId}) 因服务停止而重新排队", item.Type, item.EntityId);
            }
            catch (OperationCanceledException)
            {
                record.Status = 3; // Failed
                record.ErrorMessage = "任务被取消";
                _logger.LogWarning("后台任务 {TaskType}({EntityId}) 被取消", item.Type, item.EntityId);
            }
            catch (Exception ex)
            {
                record.Status = 3; // Failed
                record.ErrorMessage = ex.Message;
                _logger.LogError(ex, "后台任务 {TaskType}({EntityId}) 执行失败", item.Type, item.EntityId);
            }
            finally
            {
                record.CompletedAt = DateTimeOffset.UtcNow;
                record.UpdatedAt = record.CompletedAt.Value;
                try
                {
                    // 关闭流程中也要落库，否则记录会一直停留在 Running
                    await db.SaveChangesAsync(CancellationToken.None);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "后台任务 {TaskType}({EntityId}) 状态写回失败", item.Type, item.EntityId);
                }

                _taskQueue.MarkFinished(item.Type, item.EntityId);
            }
        }

        _logger.LogInformation("后台任务处理器已停止");
    }

    /// <summary>
    /// 运行期巡检：只处理「未被本进程接手」且长时间未更新的记录，避免重复投递正在排队/执行的任务
    /// </summary>
    private async Task SweepLoopAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(SweepInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
                await RecoverPendingTasksAsync(StaleThreshold, ct);
        }
        catch (OperationCanceledException)
        {
        }
    }

    /// <param name="staleAfter">只恢复最后一次更新早于该时长的记录；null 表示启动时恢复全部遗留记录</param>
    private async Task RecoverPendingTasksAsync(TimeSpan? staleAfter, CancellationToken ct)
    {
        try
        {
            List<BackgroundWorkItem> pendingItems;

            using (var scope = _scopeFactory.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<HetuDbContext>();
                var stale = await db.TaskItems
                    .Where(t => !t.IsDeleted && (t.Status == 0 || t.Status == 1))
                    .ToListAsync(ct);
                if (stale.Count == 0)
                    return;

                var now = DateTimeOffset.UtcNow;

                pendingItems = [];

                // SQLite 不支持对 DateTimeOffset 排序，按创建时间排序在内存中完成
                foreach (var group in stale.OrderBy(t => t.CreatedAt).GroupBy(t => new { t.TaskType, t.EntityId }))
                {
                    var record = group.Last();

                    // 同一 (类型, 实体) 只保留一条，其余是历史竞态产生的重复记录（先清理，避免出现两条活跃记录）
                    foreach (var duplicate in group.Where(t => t.Id != record.Id))
                    {
                        duplicate.Status = 3; // Failed
                        duplicate.ErrorMessage = "重复的排队任务记录，已自动清理";
                        duplicate.CompletedAt = now;
                        duplicate.UpdatedAt = now;
                    }

                    // Enum.TryParse 对数字字符串同样成功（"0" 会解析成第一个枚举值），必须回环比对才能识别脏数据
                    if (!Enum.TryParse<BackgroundTaskType>(record.TaskType, out var taskType) ||
                        taskType.ToString() != record.TaskType)
                    {
                        record.Status = 3; // Failed
                        record.ErrorMessage = "未知的任务类型，已终止";
                        record.CompletedAt = now;
                        record.UpdatedAt = now;
                        continue;
                    }

                    // 巡检模式只处理长时间未更新、且本进程未接手的记录，避免重复投递正在排队/执行的任务
                    if (staleAfter != null && record.UpdatedAt > now - staleAfter.Value)
                        continue;
                    if (_taskQueue.IsTracked(taskType, record.EntityId))
                        continue;

                    record.Status = 0; // 重置为 Queued，由处理器重新领取
                    record.StartedAt = null;
                    record.CompletedAt = null;
                    record.ErrorMessage = null;
                    record.UpdatedAt = now;
                    pendingItems.Add(new BackgroundWorkItem(taskType, record.EntityId, record.EntityTitle));
                }

                await db.SaveChangesAsync(ct);
                if (pendingItems.Count > 0)
                    _logger.LogInformation("恢复了 {Count} 个中断的后台任务", pendingItems.Count);
            }

            foreach (var pendingItem in pendingItems)
                await _taskQueue.QueueAsync(pendingItem, ct);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "恢复中断的后台任务失败");
        }
    }

    private async Task ProcessItemAsync(BackgroundWorkItem item, IServiceProvider sp, CancellationToken ct)
    {
        switch (item.Type)
        {
            case BackgroundTaskType.GenerateEmbedding:
                var embeddingService = sp.GetRequiredService<INoteEmbeddingService>();
                await embeddingService.GenerateEmbeddingAsync(item.EntityId, ct);
                break;

            case BackgroundTaskType.GraphExtract:
                var graphService = sp.GetRequiredService<IGraphService>();
                var result = await graphService.ExtractFromNoteAsync(item.EntityId, ct);
                if (!result.Success)
                    throw new InvalidOperationException(result.Error);
                break;

            case BackgroundTaskType.GenerateKnowledgeItemEmbedding:
                var kiEmbeddingService = sp.GetRequiredService<INoteEmbeddingService>();
                await kiEmbeddingService.GenerateKnowledgeItemEmbeddingAsync(item.EntityId, ct);
                break;

            default:
                _logger.LogWarning("未知的后台任务类型: {Type}", item.Type);
                break;
        }
    }
}
