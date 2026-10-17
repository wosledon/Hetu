using System.Collections.Concurrent;

namespace Hetu.Api.Streaming;

/// <summary>
/// 一次编码会话运行的所有权：循环跑在自己的 CancellationToken 上，与发起它的 HTTP 请求无关。
/// 客户端断开（刷新 / 跳转 / 网络抖动）只解除挂载，运行继续跑完并照常落库。
/// </summary>
public sealed class WorkRun : IDisposable
{
    private readonly CancellationTokenSource _cts = new();
    private bool _disposed;

    internal WorkRun(Guid sessionId)
    {
        SessionId = sessionId;
        Buffer = new SseEventBuffer();
    }

    public Guid SessionId { get; }

    /// <summary>运行期事件缓冲区：连接挂载时重放 + 实时转发</summary>
    public SseEventBuffer Buffer { get; }

    /// <summary>运行自己的取消令牌（「停止」按钮走这里；与请求生命周期无关）</summary>
    public CancellationToken Token => _cts.Token;

    /// <summary>请求停止：取消循环。断开连接不会走到这里。</summary>
    public void Cancel()
    {
        try { _cts.Cancel(); }
        catch (ObjectDisposedException) { /* 已结束时忽略 */ }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Buffer.Complete();
        _cts.Dispose();
    }
}

/// <summary>
/// 编码会话运行注册表（单例）。按 sessionId 索引在跑的运行，
/// 供 /stream 入站时判断「该会话已有运行」→ 直接挂载重放，而不是重复起一轮。
/// </summary>
public sealed class WorkRunRegistry
{
    private readonly ConcurrentDictionary<Guid, WorkRun> _runs = new();

    public bool IsActive(Guid sessionId) => _runs.ContainsKey(sessionId);

    public WorkRun? Get(Guid sessionId) => _runs.TryGetValue(sessionId, out var run) ? run : null;

    /// <summary>已有运行则返回它（调用方走挂载），否则新建并登记</summary>
    public WorkRun GetOrStart(Guid sessionId)
    {
        if (_runs.TryGetValue(sessionId, out var existing)) return existing;
        var run = new WorkRun(sessionId);
        return _runs.GetOrAdd(sessionId, run);
    }

    /// <summary>运行结束（无论成功失败）后摘除；已摘掉则忽略</summary>
    public void Remove(Guid sessionId, WorkRun run)
    {
        if (_runs.TryRemove(sessionId, out var current) && ReferenceEquals(current, run))
        {
            run.Dispose();
        }
    }
}
