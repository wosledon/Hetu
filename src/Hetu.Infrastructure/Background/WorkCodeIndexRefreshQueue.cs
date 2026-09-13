using System.Collections.Concurrent;
using System.Threading.Channels;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 基于 Channel 的代码索引刷新队列：入队即去重，消费端在去抖窗口结束后合并处理。
/// </summary>
public class WorkCodeIndexRefreshQueue : IWorkCodeIndexRefreshQueue
{
    private readonly Channel<Guid> _channel = Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions
    {
        SingleReader = true,
        SingleWriter = false
    });
    private readonly ConcurrentDictionary<Guid, byte> _pending = new();
    private readonly ILogger<WorkCodeIndexRefreshQueue> _logger;

    public WorkCodeIndexRefreshQueue(ILogger<WorkCodeIndexRefreshQueue> logger)
    {
        _logger = logger;
    }

    public void Enqueue(Guid projectId)
    {
        if (projectId == Guid.Empty) return;
        if (!_pending.TryAdd(projectId, 0)) return;

        if (!_channel.Writer.TryWrite(projectId))
        {
            _pending.TryRemove(projectId, out _);
            _logger.LogDebug("[WorkCodeIndex] 刷新任务入队失败 projectId={ProjectId}", projectId);
        }
    }

    public bool IsPending(Guid projectId) => _pending.ContainsKey(projectId);

    /// <summary>读取下一个待刷新项目；队列关闭时返回 <see cref="Guid.Empty"/></summary>
    public async ValueTask<Guid> DequeueAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await _channel.Reader.ReadAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return Guid.Empty;
        }
    }

    /// <summary>取出当前已入队但尚未处理的项目</summary>
    public List<Guid> DrainPending()
    {
        var drained = new List<Guid>();
        while (_channel.Reader.TryRead(out var id))
            drained.Add(id);
        return drained;
    }

    /// <summary>标记项目处理完成，允许后续再次入队</summary>
    public void MarkCompleted(Guid projectId) => _pending.TryRemove(projectId, out _);
}
