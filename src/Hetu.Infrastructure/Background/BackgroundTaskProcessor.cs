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
        _ = Task.Run(() => RecoverPendingTasksAsync(stoppingToken), CancellationToken.None);

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

            // 查找已有的 Queued 记录，或新建
            var taskTypeStr = item.Type.ToString();
            var record = await db.TaskItems
                .FirstOrDefaultAsync(t => t.EntityId == item.EntityId
                    && t.TaskType == taskTypeStr
                    && t.Status == 0, stoppingToken);

            if (record != null)
            {
                record.Status = 1; // Running
                record.StartedAt = DateTimeOffset.UtcNow;
                record.UpdatedAt = DateTimeOffset.UtcNow;
            }
            else
            {
                record = new TaskItem
                {
                    Id = Guid.NewGuid(),
                    TaskType = taskTypeStr,
                    EntityId = item.EntityId,
                    EntityTitle = item.Metadata,
                    Status = 1, // Running
                    StartedAt = DateTimeOffset.UtcNow,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
                db.TaskItems.Add(record);
            }
            await db.SaveChangesAsync(stoppingToken);

            try
            {
                await ProcessItemAsync(item, scope.ServiceProvider, stoppingToken);
                record.Status = 2; // Completed
                _logger.LogDebug("后台任务 {TaskType}({EntityId}) 完成", item.Type, item.EntityId);
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
                record.UpdatedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(stoppingToken);
            }
        }

        _logger.LogInformation("后台任务处理器已停止");
    }

    private async Task RecoverPendingTasksAsync(CancellationToken ct)
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

                    // 同一 (类型, 实体) 只保留一条，其余是历史竞态产生的重复记录
                    foreach (var duplicate in group.Where(t => t.Id != record.Id))
                    {
                        duplicate.Status = 3; // Failed
                        duplicate.ErrorMessage = "重复的排队任务记录，已自动清理";
                        duplicate.CompletedAt = now;
                        duplicate.UpdatedAt = now;
                    }

                    if (!Enum.TryParse<BackgroundTaskType>(record.TaskType, out var taskType))
                    {
                        record.Status = 3; // Failed
                        record.ErrorMessage = "未知的任务类型，已终止";
                        record.CompletedAt = now;
                        record.UpdatedAt = now;
                        continue;
                    }

                    record.Status = 0; // 重置为 Queued，由处理器重新领取
                    record.StartedAt = null;
                    record.CompletedAt = null;
                    record.ErrorMessage = null;
                    record.UpdatedAt = now;
                    pendingItems.Add(new BackgroundWorkItem(taskType, record.EntityId, record.EntityTitle));
                }

                await db.SaveChangesAsync(ct);
                _logger.LogInformation("恢复 {Count} 个中断的后台任务", pendingItems.Count);
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
                await embeddingService.GenerateEmbeddingAsync(item.EntityId);
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
