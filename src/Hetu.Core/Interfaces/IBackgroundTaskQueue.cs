namespace Hetu.Core.Interfaces;

/// <summary>
/// 后台工作项类型
/// </summary>
public enum BackgroundTaskType
{
    GenerateEmbedding,
    GraphExtract,
    GenerateKnowledgeItemEmbedding
}

/// <summary>
/// 后台工作项
/// </summary>
public record BackgroundWorkItem(
    BackgroundTaskType Type,
    Guid EntityId,
    string? Metadata = null
);

/// <summary>
/// 基于 Channel 的后台任务队列
/// </summary>
public interface IBackgroundTaskQueue
{
    /// <summary>
    /// 入队一个后台工作项
    /// </summary>
    ValueTask QueueAsync(BackgroundWorkItem item, CancellationToken cancellationToken = default);

    /// <summary>
    /// 出队一个后台工作项（阻塞等待）
    /// </summary>
    ValueTask<BackgroundWorkItem> DequeueAsync(CancellationToken cancellationToken);

    /// <summary>
    /// 该工作项是否已在本进程内排队或执行中（用于区分「等待消费」与「记录已丢失」）
    /// </summary>
    bool IsTracked(BackgroundTaskType type, Guid entityId);

    /// <summary>
    /// 标记工作项已处理完毕（成功或失败），此后不再视为在本进程内排队
    /// </summary>
    void MarkFinished(BackgroundTaskType type, Guid entityId);
}
