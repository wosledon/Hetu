using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// Dream 记忆巩固的自动模式：按「设置 → 记忆 Dream」里的开关与周期自动执行一次巩固
/// （合并相似记忆、衰减久未想起的、遗忘极弱的）。手动模式走 POST /api/memories/dream，两者共用同一逻辑。
/// </summary>
public class DreamMemoryService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DreamMemoryService> _logger;

    public DreamMemoryService(IServiceScopeFactory scopeFactory, ILogger<DreamMemoryService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("记忆 Dream 巩固服务已启动");

        // 启动即检查一次（受 LastRunAt + 周期约束，不会重复执行）
        await CheckAsync(stoppingToken);

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await CheckAsync(stoppingToken);
        }
    }

    private async Task CheckAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var memoryService = scope.ServiceProvider.GetRequiredService<IMemoryService>();

            var config = await memoryService.GetDreamConfigAsync(cancellationToken);
            if (!config.Enabled) return;

            var now = DateTimeOffset.UtcNow;
            if (config.LastRunAt != null && now - config.LastRunAt < TimeSpan.FromHours(config.IntervalHours))
                return;

            var result = await memoryService.DreamConsolidateAsync(cancellationToken);
            if (result.Success && result.Data != null)
            {
                _logger.LogInformation(
                    "[Dream] 自动巩固完成：合并 {Merged} · 衰减 {Decayed} · 遗忘 {Forgotten} · 剩余 {Remaining}",
                    result.Data.Merged, result.Data.Decayed, result.Data.Forgotten, result.Data.Remaining);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 停机
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Dream 自动巩固失败");
        }
    }
}
