using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 代码索引自动刷新：消费 <see cref="WorkCodeIndexRefreshQueue"/>，在去抖窗口结束后对同一批项目做增量重建。
/// 只刷新已有索引的项目，避免用户从未建过索引的仓库被意外索引产生 embedding 费用。
/// </summary>
public class WorkCodeIndexRefreshWorker : BackgroundService
{
    /// <summary>去抖窗口：窗口内同一项目的多次改动合并成一次重建</summary>
    private static readonly TimeSpan Debounce = TimeSpan.FromSeconds(5);

    private readonly IWorkCodeIndexRefreshQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<WorkCodeIndexRefreshWorker> _logger;

    public WorkCodeIndexRefreshWorker(
        IWorkCodeIndexRefreshQueue queue,
        IServiceScopeFactory scopeFactory,
        ILogger<WorkCodeIndexRefreshWorker> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var projectId = await DequeueAsync(stoppingToken);
            if (projectId == Guid.Empty) return;

            try
            {
                // 去抖：等待窗口结束，期间同一项目的重复改动会被合并
                await Task.Delay(Debounce, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            var batch = new List<Guid> { projectId };
            batch.AddRange(_queue.DrainPending());

            foreach (var id in batch.Distinct())
            {
                try
                {
                    await RefreshAsync(id, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[WorkCodeIndex] 自动刷新失败 projectId={ProjectId}", id);
                }
                finally
                {
                    _queue.MarkCompleted(id);
                }
            }
        }
    }

    private async Task<Guid> DequeueAsync(CancellationToken stoppingToken)
        => await _queue.DequeueAsync(stoppingToken);

    private async Task RefreshAsync(Guid projectId, CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var codeIndex = scope.ServiceProvider.GetRequiredService<IWorkCodeIndexService>();

        var status = await codeIndex.GetStatusAsync(projectId, cancellationToken);
        if (!status.Success || status.Data is null || !status.Data.IsReady)
        {
            // 没有索引的项目不自动构建，交由用户在项目设置里手动触发
            return;
        }

        if (!status.Data.IsStale)
        {
            _logger.LogDebug("[WorkCodeIndex] 项目无变更，跳过自动刷新 projectId={ProjectId}", projectId);
            return;
        }

        var result = await codeIndex.IndexProjectAsync(projectId, force: false, cancellationToken);
        if (result.Success && result.Data != null)
        {
            _logger.LogInformation(
                "[WorkCodeIndex] 自动刷新完成 projectId={ProjectId} files={Files} chunks={Chunks} stale={Stale}",
                projectId, result.Data.IndexedFiles, result.Data.IndexedChunks, status.Data.StaleFileCount);
        }
        else
        {
            _logger.LogWarning("[WorkCodeIndex] 自动刷新未完成 projectId={ProjectId} error={Error}", projectId, result.Error);
        }
    }
}
