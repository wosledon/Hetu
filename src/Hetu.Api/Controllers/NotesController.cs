using Hetu.Core.Interfaces;
using Hetu.Core.Entities;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NotesController : ControllerBase
{
    private readonly INoteService _noteService;
    private readonly INoteAiService _noteAiService;
    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly IUnitOfWork _unitOfWork;

    public NotesController(INoteService noteService, INoteAiService noteAiService, IBackgroundTaskQueue taskQueue, IUnitOfWork unitOfWork)
    {
        _noteService = noteService;
        _noteAiService = noteAiService;
        _taskQueue = taskQueue;
        _unitOfWork = unitOfWork;
    }

    [HttpGet]
    public Task<ApiResponse<PagedResult<NoteDto>>> GetList([FromQuery] GetNotesRequest request, CancellationToken cancellationToken)
        => _noteService.GetListAsync(request, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<NoteDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _noteService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<NoteDto>> Create([FromBody] CreateNoteRequest request, CancellationToken cancellationToken)
        => _noteService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<NoteDto>> Update(Guid id, [FromBody] UpdateNoteRequest request, CancellationToken cancellationToken)
        => _noteService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _noteService.DeleteAsync(id, cancellationToken);

    [HttpPost("{id:guid}/restore")]
    public Task<ApiResponse> Restore(Guid id, CancellationToken cancellationToken)
        => _noteService.RestoreAsync(id, cancellationToken);

    [HttpDelete("{id:guid}/hard")]
    public Task<ApiResponse> HardDelete(Guid id, CancellationToken cancellationToken)
        => _noteService.HardDeleteAsync(id, cancellationToken);

    [HttpPost("{id:guid}/move")]
    public Task<ApiResponse> Move(Guid id, [FromBody] MoveNoteRequest request, CancellationToken cancellationToken)
        => _noteService.MoveAsync(id, request, cancellationToken);

    [HttpPost("{id:guid}/summarize")]
    public IAsyncEnumerable<string> Summarize(Guid id, [FromBody] NoteAiRequest request, CancellationToken cancellationToken)
        => _noteAiService.SummarizeAsync(id, request, cancellationToken);

    [HttpPost("{id:guid}/continue")]
    public IAsyncEnumerable<string> Continue(Guid id, [FromBody] ContinueNoteRequest request, CancellationToken cancellationToken)
        => _noteAiService.ContinueAsync(id, request, cancellationToken);

    /// <summary>
    /// 为指定笔记生成/重建索引（加入后台队列）
    /// </summary>
    [HttpPost("{id:guid}/index")]
    public async Task<ApiResponse> GenerateIndex(Guid id, CancellationToken cancellationToken)
    {
        var note = await _noteService.GetByIdAsync(id, cancellationToken);
        if (note == null || !note.Success)
            return ApiResponse.Fail("笔记不存在");

        // 检查是否已有进行中的索引任务
        var typeName = nameof(BackgroundTaskType.GenerateEmbedding);
        var existing = await _unitOfWork.TaskItems.FindAsync(
            t => t.EntityId == id && t.TaskType == typeName && (t.Status == 0 || t.Status == 1),
            cancellationToken);
        if (existing.Count > 0)
            return ApiResponse.Fail("该笔记已有正在进行的索引任务，请等待完成");

        // 立即创建 Queued 记录，让前端立即感知
        var taskItem = new TaskItem
        {
            Id = Guid.NewGuid(),
            TaskType = typeName,
            EntityId = id,
            EntityTitle = note.Data?.Title,
            Status = 0, // Queued
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await _unitOfWork.TaskItems.AddAsync(taskItem, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateEmbedding, id, note.Data?.Title), cancellationToken);
        return ApiResponse.Ok();
    }
}
