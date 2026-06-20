using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 后台任务处理器：从 Channel 消费工作项并执行
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

            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                await ProcessItemAsync(item, scope.ServiceProvider, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogWarning("后台任务 {TaskType}({EntityId}) 被取消", item.Type, item.EntityId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "后台任务 {TaskType}({EntityId}) 执行失败", item.Type, item.EntityId);
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
                _logger.LogDebug("笔记 {NoteId} Embedding 生成完成", item.EntityId);
                break;

            case BackgroundTaskType.GraphExtract:
                var graphService = sp.GetRequiredService<IGraphService>();
                var result = await graphService.ExtractFromNoteAsync(item.EntityId, ct);
                if (result.Success)
                    _logger.LogDebug("笔记 {NoteId} 图谱提取完成", item.EntityId);
                else
                    _logger.LogWarning("笔记 {NoteId} 图谱提取失败: {Error}", item.EntityId, result.Error);
                break;

            default:
                _logger.LogWarning("未知的后台任务类型: {Type}", item.Type);
                break;
        }
    }
}
