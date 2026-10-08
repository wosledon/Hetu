using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;
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
    private readonly IBackgroundTaskCoordinator _taskCoordinator;

    public NotesController(INoteService noteService, INoteAiService noteAiService, IBackgroundTaskCoordinator taskCoordinator)
    {
        _noteService = noteService;
        _noteAiService = noteAiService;
        _taskCoordinator = taskCoordinator;
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

    /// <summary>SSE 摘要：逐字推送，错误以 [ERROR] 帧返回</summary>
    [HttpPost("{id:guid}/summarize")]
    public async Task Summarize(Guid id, [FromBody] NoteAiRequest request, CancellationToken cancellationToken)
    {
        Response.StartSseStream();
        var writer = new Streaming.SseStreamWriter(Response, cancellationToken);
        try
        {
            await foreach (var chunk in _noteAiService.SummarizeAsync(id, request, cancellationToken))
                await writer.WriteTextAsync(chunk);
        }
        catch (OperationCanceledException) { /* 客户端断开 */ }
    }

    /// <summary>SSE 续写/行内 AI：逐字推送，错误以 [ERROR] 帧返回</summary>
    [HttpPost("{id:guid}/continue")]
    public async Task Continue(Guid id, [FromBody] ContinueNoteRequest request, CancellationToken cancellationToken)
    {
        Response.StartSseStream();
        var writer = new Streaming.SseStreamWriter(Response, cancellationToken);
        try
        {
            await foreach (var chunk in _noteAiService.ContinueAsync(id, request, cancellationToken))
                await writer.WriteTextAsync(chunk);
        }
        catch (OperationCanceledException) { /* 客户端断开 */ }
    }

    /// <summary>
    /// 为指定笔记生成/重建索引（加入后台队列）
    /// </summary>
    [HttpPost("{id:guid}/index")]
    public async Task<ApiResponse> GenerateIndex(Guid id, CancellationToken cancellationToken)
    {
        var note = await _noteService.GetByIdAsync(id, cancellationToken);
        if (note == null || !note.Success)
            return ApiResponse.Fail("笔记不存在");

        var result = await _taskCoordinator.EnqueueAsync(
            new BackgroundTaskRequest(BackgroundTaskType.GenerateEmbedding, id, note.Data?.Title),
            cancellationToken);

        if (!result.Queued)
            return ApiResponse.Fail("该笔记已有正在进行的索引任务，请等待完成");

        return ApiResponse.Ok();
    }
}
