using System.Collections.Concurrent;

namespace Hetu.Core.Services;

/// <summary>
/// 运行中引导（steer）：流式执行期间允许把用户消息注入当前 Agent 循环，
/// 循环在每次迭代开始前取走并作为「运行中引导」追加进上下文。按流键（编码会话 / 对话话题）隔离。
/// 没有正在运行的流时 <see cref="Enqueue"/> 返回 false，调用方应改为排队或正常发送。
/// </summary>
public class AgentSteeringHub
{
    private readonly ConcurrentDictionary<string, ConcurrentQueue<string>> _queues = new(StringComparer.Ordinal);

    /// <summary>标记一条流开始运行；返回的对象在流结束时释放</summary>
    public IDisposable Register(string streamKey)
    {
        _queues[streamKey] = new ConcurrentQueue<string>();
        return new Registration(this, streamKey);
    }

    /// <summary>该流键当前是否有正在运行的流</summary>
    public bool IsActive(string streamKey) => _queues.ContainsKey(streamKey);

    /// <summary>入队一条引导；返回 false 表示当前没有正在运行的流</summary>
    public bool Enqueue(string streamKey, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        if (!_queues.TryGetValue(streamKey, out var queue)) return false;
        queue.Enqueue(text.Trim());
        return true;
    }

    /// <summary>取走当前全部待注入引导（由 Agent 循环在迭代边界调用）</summary>
    public IReadOnlyList<string> Drain(string streamKey)
    {
        if (!_queues.TryGetValue(streamKey, out var queue)) return [];
        var drained = new List<string>();
        while (queue.TryDequeue(out var text)) drained.Add(text);
        return drained;
    }

    private sealed class Registration(AgentSteeringHub hub, string streamKey) : IDisposable
    {
        public void Dispose() => hub._queues.TryRemove(streamKey, out _);
    }
}
