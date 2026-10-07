using Hetu.Shared.Common;
using Hetu.Shared.Tasks;

namespace Hetu.Core.Interfaces;

public interface IKanbanTaskService
{
    /// <summary>获取看板数据：按列分组的任务（归档列仅含最近 7 天）+ 统计</summary>
    Task<ApiResponse<KanbanBoardDto>> GetBoardAsync(CancellationToken cancellationToken = default);

    /// <summary>获取单个任务</summary>
    Task<ApiResponse<KanbanTaskDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>创建任务</summary>
    Task<ApiResponse<KanbanTaskDto>> CreateAsync(CreateKanbanTaskRequest request, CancellationToken cancellationToken = default);

    /// <summary>更新任务（标题、描述、优先级、负责人、标签、截止日期等）</summary>
    Task<ApiResponse<KanbanTaskDto>> UpdateAsync(Guid id, UpdateKanbanTaskRequest request, CancellationToken cancellationToken = default);

    /// <summary>流转任务：按 KanbanTaskTransitions 规则移动到目标列并重排列内顺序</summary>
    Task<ApiResponse<KanbanTaskDto>> MoveAsync(Guid id, MoveKanbanTaskRequest request, CancellationToken cancellationToken = default);

    /// <summary>删除任务（软删除）</summary>
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
