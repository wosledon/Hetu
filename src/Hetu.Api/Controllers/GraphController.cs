using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Graph;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GraphController : ControllerBase
{
    private readonly IGraphService _graphService;
    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly IUnitOfWork _unitOfWork;

    public GraphController(IGraphService graphService, IBackgroundTaskQueue taskQueue, IUnitOfWork unitOfWork)
    {
        _graphService = graphService;
        _taskQueue = taskQueue;
        _unitOfWork = unitOfWork;
    }

    [HttpGet]
    public Task<ApiResponse<GraphDataDto>> GetGraph(CancellationToken cancellationToken)
        => _graphService.GetGraphAsync(cancellationToken);

    [HttpGet("stream")]
    public Task StreamGraph(CancellationToken cancellationToken)
        => _graphService.StreamGraphAsync(HttpContext, cancellationToken);

    [HttpGet("entities/types")]
    public Task<ApiResponse<List<string>>> GetEntityTypes(CancellationToken cancellationToken)
        => _graphService.GetEntityTypesAsync(cancellationToken);

    [HttpGet("relations/types")]
    public Task<ApiResponse<List<string>>> GetRelationTypes(CancellationToken cancellationToken)
        => _graphService.GetRelationTypesAsync(cancellationToken);

    [HttpGet("entities/{id:guid}")]
    public Task<ApiResponse<GraphEntityDetailDto>> GetEntity(Guid id, CancellationToken cancellationToken)
        => _graphService.GetEntityByIdAsync(id, cancellationToken);

    [HttpPost("entities")]
    public Task<ApiResponse<GraphEntityDto>> CreateEntity([FromBody] CreateGraphEntityRequest request, CancellationToken cancellationToken)
        => _graphService.CreateEntityAsync(request, cancellationToken);

    [HttpPut("entities/{id:guid}")]
    public Task<ApiResponse<GraphEntityDto>> UpdateEntity(Guid id, [FromBody] UpdateGraphEntityRequest request, CancellationToken cancellationToken)
        => _graphService.UpdateEntityAsync(id, request, cancellationToken);

    [HttpDelete("entities/{id:guid}")]
    public Task<ApiResponse> DeleteEntity(Guid id, CancellationToken cancellationToken)
        => _graphService.DeleteEntityAsync(id, cancellationToken);

    [HttpPost("relations")]
    public Task<ApiResponse<GraphRelationDto>> CreateRelation([FromBody] CreateGraphRelationRequest request, CancellationToken cancellationToken)
        => _graphService.CreateRelationAsync(request, cancellationToken);

    [HttpDelete("relations/{id:guid}")]
    public Task<ApiResponse> DeleteRelation(Guid id, CancellationToken cancellationToken)
        => _graphService.DeleteRelationAsync(id, cancellationToken);

    [HttpPost("extract/{noteId:guid}")]
    public Task<ApiResponse<ExtractGraphResultDto>> ExtractFromNote(Guid noteId, CancellationToken cancellationToken)
        => _graphService.ExtractFromNoteAsync(noteId, cancellationToken);

    [HttpPost("extract/batch")]
    public async Task<ApiResponse<List<ExtractGraphResultDto>>> BatchExtract([FromBody] BatchExtractGraphRequest request, CancellationToken cancellationToken)
    {
        var results = new List<ExtractGraphResultDto>();
        foreach (var noteId in request.NoteIds)
        {
            var result = await _graphService.ExtractFromNoteAsync(noteId, cancellationToken);
            if (result.Success && result.Data != null)
                results.Add(result.Data);
        }
        return ApiResponse<List<ExtractGraphResultDto>>.Ok(results);
    }

    [HttpPost("extract/batch-queue")]
    public async Task<ApiResponse<BatchQueueResultDto>> BatchExtractQueue([FromBody] BatchExtractGraphRequest request, CancellationToken cancellationToken)
    {
        var typeName = nameof(BackgroundTaskType.GraphExtract);
        var noteIds = request.NoteIds.Distinct().ToList();
        var pendingItems = new List<BackgroundWorkItem>();
        var skipped = 0;

        if (noteIds.Count > 0)
        {
            var existing = await _unitOfWork.TaskItems.FindAsync(
                t => noteIds.Contains(t.EntityId) && t.TaskType == typeName && (t.Status == 0 || t.Status == 1),
                cancellationToken);
            var busyNoteIds = existing.Select(t => t.EntityId).ToHashSet();

            foreach (var noteId in noteIds)
            {
                if (busyNoteIds.Contains(noteId))
                {
                    skipped++;
                    continue;
                }

                var taskItem = new TaskItem
                {
                    Id = Guid.NewGuid(),
                    TaskType = typeName,
                    EntityId = noteId,
                    Status = 0, // Queued
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
                await _unitOfWork.TaskItems.AddAsync(taskItem, cancellationToken);
                pendingItems.Add(new BackgroundWorkItem(BackgroundTaskType.GraphExtract, noteId));
            }

            // 必须先提交队列记录再入队，否则处理器查不到 Queued 记录会重复建一条任务
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }

        foreach (var pendingItem in pendingItems)
            await _taskQueue.QueueAsync(pendingItem, cancellationToken);

        return ApiResponse<BatchQueueResultDto>.Ok(new BatchQueueResultDto
        {
            QueuedCount = pendingItems.Count,
            SkippedCount = skipped,
        });
    }

    [HttpPost("merge")]
    public Task<ApiResponse> MergeEntities([FromBody] MergeGraphEntitiesRequest request, CancellationToken cancellationToken)
        => _graphService.MergeEntitiesAsync(request, cancellationToken);
}
