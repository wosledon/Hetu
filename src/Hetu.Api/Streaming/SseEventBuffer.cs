using System.Threading.Channels;

namespace Hetu.Api.Streaming;

/// <summary>
/// 运行期 SSE 事件缓冲区：发布的事件既推给当前挂着的客户端，也留一份供重放。
///
/// 为什么需要：Agent 循环原先直接跑在 HTTP 请求的 CancellationToken 上，客户端一断开
/// （刷新页面、地址栏跳转、网络抖动）循环就跟着取消——用户在 Code 页干活，按个 F5 本轮就废了。
/// 现在循环的生命周期归 <see cref="WorkRunRegistry"/>，与任何单个连接无关；连接只负责
/// 「attach」：先把缓冲区里的事件重放一遍，再接收后续实时事件。
/// </summary>
public sealed class SseEventBuffer
{
    /// <summary>单运行保留的事件上限：够覆盖一次长回合的过程帧，又不至于无界增长</summary>
    private const int MaxEvents = 5000;

    private readonly List<string> _events = new();
    private readonly Channel<string> _live = Channel.CreateUnbounded<string>();
    private readonly object _lock = new();
    private bool _completed;

    /// <summary>已缓冲的事件条数（供状态查询判断是否值得重连）</summary>
    public int Count
    {
        get { lock (_lock) { return _events.Count; } }
    }

    public bool IsCompleted
    {
        get { lock (_lock) { return _completed; } }
    }

    /// <summary>发布一条事件：入缓冲区，并转手给所有已挂载的实时通道</summary>
    public void Publish(string data)
    {
        lock (_lock)
        {
            if (_completed) return;
            if (_events.Count >= MaxEvents) _events.RemoveAt(0);
            _events.Add(data);
        }
        _live.Writer.TryWrite(data);
    }

    /// <summary>快照当前已缓冲的事件（重放用，调用方自行决定写去哪）</summary>
    public IReadOnlyList<string> Snapshot()
    {
        lock (_lock) { return _events.ToList(); }
    }

    /// <summary>
    /// 挂载一个客户端：先重放缓冲区，再持续转发实时事件，直到运行结束或连接断开。
    /// </summary>
    public async Task AttachAsync(Func<string, Task> write, CancellationToken ct)
    {
        foreach (var data in Snapshot())
        {
            if (ct.IsCancellationRequested) return;
            try { await write(data); }
            catch (OperationCanceledException) { return; }
            catch { return; } // 连接已断开：不再重试，运行本身不受影响
        }

        try
        {
            await foreach (var data in _live.Reader.ReadAllAsync(ct))
            {
                try { await write(data); }
                catch (OperationCanceledException) { return; }
                catch { return; }
            }
        }
        catch (OperationCanceledException)
        {
            // 客户端断开：正常路径
        }
        catch (ChannelClosedException)
        {
            // 运行已结束且通道关闭
        }
    }

    /// <summary>运行结束：停止接收新事件，关闭实时通道让挂载方收尾</summary>
    public void Complete()
    {
        lock (_lock)
        {
            if (_completed) return;
            _completed = true;
        }
        _live.Writer.TryComplete();
    }
}
