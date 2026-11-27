using Hetu.Core.Interfaces;
using Hetu.Infrastructure.VectorData;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>按保留天数清理会话历史向量与 agent-session 快照。</summary>
public sealed class AgentMemoryCleanupService : BackgroundService
{
    private const int DefaultRetentionDays = 30;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AgentMemoryCleanupService> _logger;

    public AgentMemoryCleanupService(
        IServiceScopeFactory scopeFactory,
        ILogger<AgentMemoryCleanupService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await CleanupAsync(stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        while (await timer.WaitForNextTickAsync(stoppingToken))
            await CleanupAsync(stoppingToken);
    }

    private async Task CleanupAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
            var store = scope.ServiceProvider.GetRequiredService<HetuChatHistoryVectorStore>();

            var retentionSetting = await unitOfWork.AppSettings.GetByKeyAsync("HistoryMemoryRetentionDays", ct);
            var retentionDays = int.TryParse(retentionSetting?.Value, out var parsed)
                ? Math.Clamp(parsed, 1, 3650)
                : DefaultRetentionDays;
            var cutoff = DateTimeOffset.UtcNow.AddDays(-retentionDays);

            var removedVectors = await store.PruneAsync(cutoff, ct);

            var removedSessions = 0;
            foreach (var setting in await unitOfWork.AppSettings.GetAllAsync(ct))
            {
                if (!setting.Key.StartsWith("agent-session:", StringComparison.Ordinal)
                    || setting.UpdatedAt >= cutoff) continue;
                await unitOfWork.AppSettings.DeleteAsync(setting, ct);
                removedSessions++;
            }
            if (removedSessions > 0) await unitOfWork.SaveChangesAsync(ct);

            if (removedVectors + removedSessions > 0)
                _logger.LogInformation(
                    "[AgentMemory] 清理完成：向量 {Vectors} 条，会话快照 {Sessions} 条（保留 {Days} 天）",
                    removedVectors, removedSessions, retentionDays);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "[AgentMemory] 清理失败");
        }
    }
}