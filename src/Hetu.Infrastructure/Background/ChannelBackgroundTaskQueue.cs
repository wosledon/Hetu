using System.Threading.Channels;
using Hetu.Core.Interfaces;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 基于 System.Threading.Channels 的后台任务队列实现
/// </summary>
public class ChannelBackgroundTaskQueue : IBackgroundTaskQueue
{
    private readonly Channel<BackgroundWorkItem> _channel;

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
        await _channel.Writer.WriteAsync(item, cancellationToken);
    }

    public async ValueTask<BackgroundWorkItem> DequeueAsync(CancellationToken cancellationToken)
    {
        return await _channel.Reader.ReadAsync(cancellationToken);
    }
}
