using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 定时任务执行器：按 TaskKind 分发执行
/// </summary>
public interface IScheduledTaskExecutor
{
    /// <summary>支持的 TaskKind</summary>
    string Kind { get; }

    /// <summary>
    /// 执行任务，返回结果摘要
    /// </summary>
    Task<string> ExecuteAsync(ScheduledTask task, CancellationToken cancellationToken = default);
}
