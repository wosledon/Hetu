using Hetu.Core.Entities;
using Hetu.Shared.Common;
using Hetu.Shared.Tasks;

namespace Hetu.Core.Interfaces;

public interface IScheduledTaskService
{
    Task<ApiResponse<List<ScheduledTaskDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<ScheduledTaskDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ScheduledTaskDto>> CreateAsync(CreateScheduledTaskRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<ScheduledTaskDto>> UpdateAsync(Guid id, UpdateScheduledTaskRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ScheduledTaskDto>> ToggleAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ScheduledTaskExecutionDto>> RunNowAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<ScheduledTaskExecutionDto>>> GetExecutionsAsync(Guid id, int limit = 50, CancellationToken cancellationToken = default);
    Task<ApiResponse<ScheduledTaskTargetOptionsDto>> GetTargetOptionsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 计算给定任务的下次运行时间（UTC）。若无效返回 null。
    /// </summary>
    DateTimeOffset? CalculateNextRun(ScheduledTask task);

    /// <summary>
    /// 获取到点需要执行的任务列表（后台 Runner 调用）
    /// </summary>
    Task<List<ScheduledTask>> GetDueTasksAsync(CancellationToken cancellationToken = default);
}
