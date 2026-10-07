using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 任务看板：卡片 CRUD 与状态流转（待规划/待办/进行中/审核中/已阻塞/已完成/已归档）
/// </summary>
[ApiController]
[Route("api/kanban-tasks")]
public class KanbanTasksController : ControllerBase
{
    private readonly IKanbanTaskService _kanbanTaskService;

    public KanbanTasksController(IKanbanTaskService kanbanTaskService)
    {
        _kanbanTaskService = kanbanTaskService;
    }

    /// <summary>获取看板（按列分组；归档列仅含最近 7 天）</summary>
    [HttpGet]
    public Task<ApiResponse<KanbanBoardDto>> GetBoard(CancellationToken cancellationToken)
        => _kanbanTaskService.GetBoardAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<KanbanTaskDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _kanbanTaskService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<KanbanTaskDto>> Create([FromBody] CreateKanbanTaskRequest request, CancellationToken cancellationToken)
        => _kanbanTaskService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<KanbanTaskDto>> Update(Guid id, [FromBody] UpdateKanbanTaskRequest request, CancellationToken cancellationToken)
        => _kanbanTaskService.UpdateAsync(id, request, cancellationToken);

    /// <summary>流转：移动到目标列并指定列内位置</summary>
    [HttpPut("{id:guid}/move")]
    public Task<ApiResponse<KanbanTaskDto>> Move(Guid id, [FromBody] MoveKanbanTaskRequest request, CancellationToken cancellationToken)
        => _kanbanTaskService.MoveAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _kanbanTaskService.DeleteAsync(id, cancellationToken);
}
