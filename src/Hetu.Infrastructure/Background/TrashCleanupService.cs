using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

public class TrashCleanupService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TrashCleanupService> _logger;

    public TrashCleanupService(IServiceScopeFactory scopeFactory, ILogger<TrashCleanupService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("回收站自动清理服务已启动");

        // 启动时先执行一次
        await CleanupAsync(stoppingToken);

        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await CleanupAsync(stoppingToken);
        }
    }

    private async Task CleanupAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
            var graphService = scope.ServiceProvider.GetRequiredService<IGraphService>();

            var cutoff = DateTimeOffset.UtcNow.AddDays(-30);
            var oldNotes = await unitOfWork.Notes.GetOldDeletedAsync(cutoff, cancellationToken);

            foreach (var note in oldNotes)
            {
                // 先清理该笔记关联的知识图谱数据
                await graphService.CleanUpByNoteIdAsync(note.Id, cancellationToken);
                await unitOfWork.Notes.HardDeleteAsync(note, cancellationToken);
            }

            if (oldNotes.Count > 0)
            {
                await unitOfWork.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("已清理 {Count} 条超过 30 天的回收站笔记", oldNotes.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "回收站自动清理失败");
        }
    }
}
