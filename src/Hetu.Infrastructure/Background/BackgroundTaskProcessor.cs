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

            // 创建任务记录
            var record = new TaskItem
            {
                Id = Guid.NewGuid(),
                TaskType = item.Type.ToString(),
                EntityId = item.EntityId,
                EntityTitle = item.Metadata,
                Status = 1, // Running
                StartedAt = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.TaskItems.Add(record);
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
