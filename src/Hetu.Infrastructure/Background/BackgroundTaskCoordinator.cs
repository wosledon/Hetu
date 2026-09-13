using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 后台任务统一登记实现：用进程级信号量串行化「查重 + 建记录 + 入队」，
/// 消除并发点击时同一 (类型, 实体) 建出两条任务的竞态。
/// </summary>
/// <remarks>
/// 信号量为静态字段，因此跨请求作用域有效；记录先落库再投递内存队列，
/// 投递失败时遗留的 Queued 记录由 <see cref="BackgroundTaskProcessor"/> 的恢复与巡检补投。
/// </remarks>
public class BackgroundTaskCoordinator : IBackgroundTaskCoordinator
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private readonly IUnitOfWork _unitOfWork;
    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly ILogger<BackgroundTaskCoordinator> _logger;

    public BackgroundTaskCoordinator(
        IUnitOfWork unitOfWork,
        IBackgroundTaskQueue taskQueue,
        ILogger<BackgroundTaskCoordinator> logger)
    {
        _unitOfWork = unitOfWork;
        _taskQueue = taskQueue;
        _logger = logger;
    }

    public async Task<BackgroundTaskEnqueueResult> EnqueueAsync(BackgroundTaskRequest request, CancellationToken cancellationToken = default)
        => await EnqueueBatchAsync([request], cancellationToken);

    public async Task<BackgroundTaskEnqueueResult> EnqueueBatchAsync(IReadOnlyCollection<BackgroundTaskRequest> requests, CancellationToken cancellationToken = default)
    {
        if (requests.Count == 0)
            return new BackgroundTaskEnqueueResult(0, 0);

        // 同一批内按 (类型, 实体) 去重
        var unique = new Dictionary<(BackgroundTaskType Type, Guid EntityId), BackgroundTaskRequest>();
        var skipped = 0;
        foreach (var request in requests)
        {
            if (!unique.TryAdd((request.Type, request.EntityId), request))
                skipped++;
        }

        var pendingItems = new List<BackgroundWorkItem>(unique.Count);

        await Gate.WaitAsync(cancellationToken);
        try
        {
            var entityIds = unique.Keys.Select(k => k.EntityId).Distinct().ToList();
            var typeNames = unique.Keys.Select(k => k.Type.ToString()).Distinct().ToList();

            var active = await _unitOfWork.TaskItems.FindAsync(
                t => entityIds.Contains(t.EntityId) && typeNames.Contains(t.TaskType) && (t.Status == 0 || t.Status == 1),
                cancellationToken);
            var activeKeys = active.Select(t => $"{t.TaskType}:{t.EntityId}").ToHashSet();

            var now = DateTimeOffset.UtcNow;
            foreach (var (key, request) in unique)
            {
                if (activeKeys.Contains($"{key.Type}:{key.EntityId}"))
                {
                    _logger.LogDebug("跳过重复任务: {TaskType}({EntityId}), 已有进行中任务", key.Type, key.EntityId);
                    skipped++;
                    continue;
                }

                await _unitOfWork.TaskItems.AddAsync(new TaskItem
                {
                    Id = Guid.NewGuid(),
                    TaskType = key.Type.ToString(),
                    EntityId = key.EntityId,
                    EntityTitle = request.EntityTitle,
                    Status = 0, // Queued
                    CreatedAt = now,
                    UpdatedAt = now,
                }, cancellationToken);

                pendingItems.Add(new BackgroundWorkItem(key.Type, key.EntityId, request.EntityTitle));
            }

            // 必须先提交队列记录再入队，否则处理器查不到 Queued 记录会重复建一条任务
            if (pendingItems.Count > 0)
                await _unitOfWork.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            Gate.Release();
        }

        // 入队放在锁外：通道写满时不应阻塞其他登记请求
        foreach (var pendingItem in pendingItems)
            await _taskQueue.QueueAsync(pendingItem, cancellationToken);

        return new BackgroundTaskEnqueueResult(pendingItems.Count, skipped);
    }

    public async Task<TaskItem> ClaimAsync(BackgroundTaskType type, Guid entityId, string? entityTitle, CancellationToken cancellationToken = default)
    {
        await Gate.WaitAsync(cancellationToken);
        try
        {
            var typeName = type.ToString();
            var records = await _unitOfWork.TaskItems.FindAsync(
                t => t.EntityId == entityId && t.TaskType == typeName && (t.Status == 0 || t.Status == 1),
                cancellationToken);

            var now = DateTimeOffset.UtcNow;
            // SQLite 不支持服务端排序 DateTimeOffset，取最新记录在内存中完成
            var record = records.OrderByDescending(t => t.CreatedAt).FirstOrDefault();
            if (record == null)
            {
                record = new TaskItem
                {
                    Id = Guid.NewGuid(),
                    TaskType = typeName,
                    EntityId = entityId,
                    Status = 1, // Running
                    StartedAt = now,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                await _unitOfWork.TaskItems.AddAsync(record, cancellationToken);
            }

            record.EntityTitle ??= entityTitle;
            record.Status = 1; // Running
            record.StartedAt = now;
            record.CompletedAt = null;
            record.ErrorMessage = null;
            record.UpdatedAt = now;

            // FindAsync 走 AsNoTracking，必须显式挂回上下文，否则状态变更不会被保存；
            // UpdateAsync 在已有同 Id 跟踪实例时返回跟踪实例，调用方后续改状态才能生效
            record = await _unitOfWork.TaskItems.UpdateAsync(record, cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return record;
        }
        finally
        {
            Gate.Release();
        }
    }
}
