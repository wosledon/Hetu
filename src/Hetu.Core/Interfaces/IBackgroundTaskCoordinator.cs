using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 一次后台任务登记请求
/// </summary>
public record BackgroundTaskRequest(
    BackgroundTaskType Type,
    Guid EntityId,
    string? EntityTitle = null
);

/// <summary>
/// 后台任务登记结果
/// </summary>
public record BackgroundTaskEnqueueResult(int QueuedCount, int SkippedCount)
{
    /// <summary>是否成功入队了至少一个任务</summary>
    public bool Queued => QueuedCount > 0;

    /// <summary>是否因为已有进行中任务被跳过</summary>
    public bool Skipped => SkippedCount > 0;
}

/// <summary>
/// 后台任务统一登记入口：串行化「查重 + 建记录 + 入队」，保证同一 (类型, 实体) 不会出现并发重复任务。
/// </summary>
public interface IBackgroundTaskCoordinator
{
    /// <summary>
    /// 登记一个后台任务：无进行中任务时创建 Queued 记录并入队，否则跳过
    /// </summary>
    Task<BackgroundTaskEnqueueResult> EnqueueAsync(BackgroundTaskRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// 批量登记后台任务：先批量提交队列记录再统一入队
    /// </summary>
    Task<BackgroundTaskEnqueueResult> EnqueueBatchAsync(IReadOnlyCollection<BackgroundTaskRequest> requests, CancellationToken cancellationToken = default);

    /// <summary>
    /// 后台处理器领取任务：复用已有排队记录，缺失时补建，返回已置为 Running 的记录
    /// </summary>
    Task<TaskItem> ClaimAsync(BackgroundTaskType type, Guid entityId, string? entityTitle, CancellationToken cancellationToken = default);
}
