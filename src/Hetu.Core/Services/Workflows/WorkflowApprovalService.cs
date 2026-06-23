using System.Collections.Concurrent;

namespace Hetu.Core.Services.Workflows;

/// <summary>
/// 工作流人工审批服务。Singleton，管理 Human 节点的挂起审批请求。
/// 镜像 ToolExecutionService 的 Session&lt;SessionPendingState&gt; 模式，
/// 通过 TaskCompletionSource 实现 Human 节点的阻塞等待。
/// </summary>
public class WorkflowApprovalService
{
    private readonly ConcurrentDictionary<string, PendingApproval> _pending = new();

    /// <summary>创建一个挂起审批并返回等待的 Task</summary>
    public Task<PendingApproval> WaitForApprovalAsync(string runId, string nodeId, string prompt, TimeSpan timeout)
    {
        var key = $"{runId}:{nodeId}";
        var approval = new PendingApproval
        {
            RunId = runId,
            NodeId = nodeId,
            Prompt = prompt,
            Tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously)
        };
        _pending[key] = approval;

        // 超时自动拒绝
        _ = Task.Delay(timeout).ContinueWith(_ =>
        {
            if (_pending.TryRemove(key, out var p) && !p.Tcs.Task.IsCompleted)
                p.Tcs.TrySetResult(false);
        });

        return Task.FromResult(approval);
    }

    /// <summary>提交审批结果</summary>
    public bool TryResolve(string runId, string nodeId, bool approved)
    {
        var key = $"{runId}:{nodeId}";
        if (_pending.TryRemove(key, out var p))
        {
            return p.Tcs.TrySetResult(approved);
        }
        return false;
    }

    /// <summary>获取运行的所有挂起审批</summary>
    public List<PendingApproval> GetPendingForRun(string runId)
        => _pending.Values.Where(p => p.RunId == runId).ToList();

    /// <summary>清除运行的所有挂起审批（取消运行时）</summary>
    public void ClearRun(string runId)
    {
        foreach (var kv in _pending.Where(p => p.Value.RunId == runId).ToList())
        {
            if (_pending.TryRemove(kv.Key, out var p))
                p.Tcs.TrySetCanceled();
        }
    }
}

public class PendingApproval
{
    public string RunId { get; set; } = "";
    public string NodeId { get; set; } = "";
    public string Prompt { get; set; } = "";
    public TaskCompletionSource<bool> Tcs { get; set; } = null!;
    public Task<bool> Task => Tcs.Task;
}
