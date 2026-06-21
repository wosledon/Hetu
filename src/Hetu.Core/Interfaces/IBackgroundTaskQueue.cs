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
}
