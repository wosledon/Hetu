using System.Collections.Concurrent;
using Hetu.Core.Services.Tools;

namespace Hetu.Core.Services;

/// <summary>
/// 对话会话的实时权限模式：流式执行期间切换审批档位时由端上推送，Agent 循环逐次读取，
/// 不用等下一轮消息才生效（编码会话的模式直接读会话行，不走这里）。按流键（对话话题）隔离。
/// </summary>
public class AgentPermissionModeHub
{
    private readonly ConcurrentDictionary<string, WorkPermissionMode> _modes = new(StringComparer.Ordinal);

    /// <summary>标记一条流开始运行并写入初始档位；返回的对象在流结束时清理</summary>
    public IDisposable Register(string streamKey, WorkPermissionMode mode)
    {
        _modes[streamKey] = mode;
        return new Registration(this, streamKey);
    }

    /// <summary>更新档位；当前没有正在运行的流时返回 false（无需通知后端）</summary>
    public bool TrySet(string streamKey, WorkPermissionMode mode)
    {
        if (!_modes.ContainsKey(streamKey)) return false;
        _modes[streamKey] = mode;
        return true;
    }

    /// <summary>当前生效档位；没有正在运行的流时为 null</summary>
    public WorkPermissionMode? Get(string streamKey)
        => _modes.TryGetValue(streamKey, out var mode) ? mode : null;

    private sealed class Registration(AgentPermissionModeHub hub, string streamKey) : IDisposable
    {
        public void Dispose() => hub._modes.TryRemove(streamKey, out _);
    }
}
