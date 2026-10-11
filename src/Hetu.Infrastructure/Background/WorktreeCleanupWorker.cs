using Hetu.Core.Services.Work;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 工作树自动清理：启动后先清一次（跳过刚创建/最近活动的工作树），随后按配置的间隔重复
/// （默认 6 小时，可在设置页调整或关闭）。正常的删会话/切回当前分支已即时清理，这里兜底
/// 「已合并但没人管」与「无主残骸」两类工作树。
/// </summary>
public class WorktreeCleanupWorker : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<WorktreeCleanupWorker> _logger;

    public WorktreeCleanupWorker(IServiceScopeFactory scopeFactory, ILogger<WorktreeCleanupWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // 启动阶段先让迁移/预热跑完，避免和首个会话创建工作树抢 IO
            await Task.Delay(StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (true)
        {
            var intervalHours = 6;
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var cleanup = scope.ServiceProvider.GetRequiredService<WorktreeCleanupService>();
                var config = await cleanup.GetConfigAsync(stoppingToken);
                intervalHours = Math.Clamp(config.IntervalHours, 1, 168);

                var result = await cleanup.CleanupAllAsync(force: false, stoppingToken);
                if (result.Removed > 0)
                {
                    _logger.LogInformation("[worktree] 自动清理完成：清理 {Removed} 个，保留 {Kept} 个", result.Removed, result.Kept);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[worktree] 自动清理失败，{Hours} 小时后重试", intervalHours);
            }

            try
            {
                await Task.Delay(TimeSpan.FromHours(intervalHours), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
