namespace Hetu.Core.Interfaces;

/// <summary>
/// 代码索引自动刷新队列：工作区文件被改动后入队，由后台服务合并去抖后做增量重建，
/// 避免每次写文件都立刻触发 embedding 调用。
/// </summary>
public interface IWorkCodeIndexRefreshQueue
{
    /// <summary>请求刷新指定项目的索引（同一项目重复入队会被合并）</summary>
    void Enqueue(Guid projectId);

    /// <summary>该项目是否有刷新任务在排队</summary>
    bool IsPending(Guid projectId);

    /// <summary>读取下一个待刷新项目；队列被取消时返回 <see cref="Guid.Empty"/></summary>
    ValueTask<Guid> DequeueAsync(CancellationToken cancellationToken);

    /// <summary>取出当前已入队但尚未处理的项目（与去抖窗口配合做批量合并）</summary>
    List<Guid> DrainPending();

    /// <summary>标记项目处理完成，允许后续再次入队</summary>
    void MarkCompleted(Guid projectId);
}
