using System.Collections.Concurrent;
using System.Threading.Channels;
using Hetu.Core.Interfaces;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 基于 System.Threading.Channels 的后台任务队列实现
/// </summary>
public class ChannelBackgroundTaskQueue : IBackgroundTaskQueue
{
    private readonly Channel<BackgroundWorkItem> _channel;

    // 已入队但尚未处理完的工作项，用于让恢复逻辑分辨「在等消费」与「记录丢失」
    private readonly ConcurrentDictionary<(BackgroundTaskType Type, Guid EntityId), byte> _tracked = new();

    public ChannelBackgroundTaskQueue()
    {
        // 有界队列，防止内存无限增长
        _channel = Channel.CreateBounded<BackgroundWorkItem>(new BoundedChannelOptions(500)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false
        });
    }

    public async ValueTask QueueAsync(BackgroundWorkItem item, CancellationToken cancellationToken = default)
    {
        // 同一 (类型, 实体) 只保留一个在途工作项，重复投递直接忽略
        if (!_tracked.TryAdd((item.Type, item.EntityId), 0))
            return;

        try
        {
            await _channel.Writer.WriteAsync(item, cancellationToken);
        }
        catch
        {
            _tracked.TryRemove((item.Type, item.EntityId), out _);
            throw;
        }
    }

    public async ValueTask<BackgroundWorkItem> DequeueAsync(CancellationToken cancellationToken)
    {
        return await _channel.Reader.ReadAsync(cancellationToken);
    }

    public bool IsTracked(BackgroundTaskType type, Guid entityId)
        => _tracked.ContainsKey((type, entityId));

    public void MarkFinished(BackgroundTaskType type, Guid entityId)
        => _tracked.TryRemove((type, entityId), out _);
}
