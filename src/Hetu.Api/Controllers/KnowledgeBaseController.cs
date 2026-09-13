using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/knowledge-base")]
public class KnowledgeBaseController : ControllerBase
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ISemanticSearchService _semanticSearchService;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly IBackgroundTaskCoordinator _taskCoordinator;

    public KnowledgeBaseController(
        IUnitOfWork unitOfWork,
        ISemanticSearchService semanticSearchService,
        IEmbeddingProviderFactory embeddingProviderFactory,
        IBackgroundTaskCoordinator taskCoordinator)
    {
        _unitOfWork = unitOfWork;
        _semanticSearchService = semanticSearchService;
        _embeddingProviderFactory = embeddingProviderFactory;
        _taskCoordinator = taskCoordinator;
    }

    /// <summary>笔记类知识项按笔记聚合索引，其余按知识项自身索引</summary>
    private static (BackgroundTaskType Type, Guid EntityId) ResolveTarget(KnowledgeItem item)
        => item.Type == KnowledgeItemType.Note && item.NoteId.HasValue
            ? (BackgroundTaskType.GenerateEmbedding, item.NoteId.Value)
            : (BackgroundTaskType.GenerateKnowledgeItemEmbedding, item.Id);

    /// <summary>
    /// 获取知识库状态概览
    /// </summary>
    [HttpGet("status")]
    public async Task<ApiResponse<KnowledgeBaseStatusDto>> GetStatus(CancellationToken cancellationToken)
    {
        var allItems = await _unitOfWork.KnowledgeItems.GetAllAsync(cancellationToken);
        var chunkEmbeddings = await _unitOfWork.KnowledgeItems.GetAllChunkEmbeddingMetadataAsync(cancellationToken);

        var indexedItemIds = chunkEmbeddings
            .Select(ce => ce.KnowledgeItemId)
            .Distinct()
            .ToHashSet();

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);

        // 查询正在运行/排队的 Embedding 相关任务
        var allTasks = await _unitOfWork.TaskItems.GetAllAsync(cancellationToken);
        var runningTaskCount = allTasks.Count(t =>
            (t.Status == 0 || t.Status == 1) &&
            (t.TaskType == nameof(BackgroundTaskType.GenerateEmbedding) ||
             t.TaskType == nameof(BackgroundTaskType.GenerateKnowledgeItemEmbedding)));

        var status = new KnowledgeBaseStatusDto
        {
            TotalItems = allItems.Count,
            IndexedItems = indexedItemIds.Count,
            UnindexedItems = allItems.Count - indexedItemIds.Count,
            NoteCount = allItems.Count(k => k.Type == KnowledgeItemType.Note),
            FileCount = allItems.Count(k => k.Type == KnowledgeItemType.File),
            UrlCount = allItems.Count(k => k.Type == KnowledgeItemType.Url),
            HasEmbeddingProvider = provider != null,
            Dimensions = provider?.Dimensions ?? 0,
            RunningTaskCount = runningTaskCount,
        };

        return ApiResponse<KnowledgeBaseStatusDto>.Ok(status);
    }

    /// <summary>
    /// 获取知识项的 Embedding 状态列表（支持按类型筛选）
    /// </summary>
    [HttpGet("embeddings")]
    public async Task<ApiResponse<List<KnowledgeItemEmbeddingStatusDto>>> GetEmbeddingStatuses(
        [FromQuery] string? type,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<KnowledgeItem> items;
        if (!string.IsNullOrEmpty(type) && Enum.TryParse<KnowledgeItemType>(type, true, out var itemType))
        {
            items = await _unitOfWork.KnowledgeItems.GetByTypeAsync(itemType, cancellationToken);
        }
        else
        {
            items = await _unitOfWork.KnowledgeItems.GetAllAsync(cancellationToken);
        }

        var chunkEmbeddings = await _unitOfWork.KnowledgeItems.GetAllChunkEmbeddingMetadataAsync(cancellationToken);

        // 按知识项分组 chunk embeddings
        var chunkMap = chunkEmbeddings
            .GroupBy(ce => ce.KnowledgeItemId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // 查询所有正在运行/排队的任务
        var allTasks = await _unitOfWork.TaskItems.GetAllAsync(cancellationToken);
        var runningEntityIds = allTasks
            .Where(t => (t.Status == 0 || t.Status == 1) &&
                        (t.TaskType == nameof(BackgroundTaskType.GenerateEmbedding) ||
                         t.TaskType == nameof(BackgroundTaskType.GenerateKnowledgeItemEmbedding)))
            .Select(t => t.EntityId)
            .ToHashSet();

        var result = items.Select(k =>
        {
            var entityId = k.Type == KnowledgeItemType.Note && k.NoteId.HasValue ? k.NoteId.Value : k.Id;
            return new KnowledgeItemEmbeddingStatusDto
            {
                Id = k.Id,
                Type = k.Type.ToString().ToLower(),
                Title = k.Title,
                SourceUrl = k.SourceUrl,
                FileName = k.FileName,
                FileSize = k.FileSize,
                NoteId = k.NoteId,
                UpdatedAt = k.UpdatedAt,
                HasEmbedding = chunkMap.ContainsKey(k.Id),
                EmbeddingModel = chunkMap.TryGetValue(k.Id, out var chunks) && chunks.Count > 0 ? chunks[0].Model : null,
                EmbeddingDimensions = chunkMap.TryGetValue(k.Id, out var c2) && c2.Count > 0 ? c2[0].Dimensions : 0,
                EmbeddingUpdatedAt = chunkMap.TryGetValue(k.Id, out var c3) && c3.Count > 0 ? c3.Max(c => c.UpdatedAt) : null,
                ChunkCount = chunkMap.TryGetValue(k.Id, out var cc) ? cc.Count : 0,
                HasRunningTask = runningEntityIds.Contains(entityId),
            };
        }).ToList();

        return ApiResponse<List<KnowledgeItemEmbeddingStatusDto>>.Ok(result);
    }

    /// <summary>
    /// 为指定知识项生成 Embedding
    /// </summary>
    [HttpPost("embeddings/{id:guid}")]
    public async Task<ApiResponse> GenerateEmbedding(Guid id, CancellationToken cancellationToken)
    {
        var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, cancellationToken);
        if (item == null)
            return ApiResponse.Fail("知识项不存在");

        var (taskType, entityId) = ResolveTarget(item);
        var result = await _taskCoordinator.EnqueueAsync(
            new BackgroundTaskRequest(taskType, entityId, item.Title),
            cancellationToken);

        if (!result.Queued)
            return ApiResponse.Fail("该知识项已有正在进行的索引任务，请等待完成");

        return ApiResponse.Ok();
    }

    /// <summary>
    /// 批量为未索引知识项生成 Embedding
    /// </summary>
    [HttpPost("embeddings/batch")]
    public async Task<ApiResponse<BatchEmbeddingResultDto>> BatchGenerateEmbeddings(CancellationToken cancellationToken)
    {
        var allItems = await _unitOfWork.KnowledgeItems.GetAllAsync(cancellationToken);
        var chunkEmbeddings = await _unitOfWork.KnowledgeItems.GetAllChunkEmbeddingMetadataAsync(cancellationToken);

        var indexedItemIds = chunkEmbeddings
            .Select(ce => ce.KnowledgeItemId)
            .Distinct()
            .ToHashSet();

        // 去重与并发保护由 IBackgroundTaskCoordinator 统一处理
        var unindexedItems = allItems.Where(k => !indexedItemIds.Contains(k.Id)).ToList();
        var requests = unindexedItems.Select(item =>
        {
            var (taskType, entityId) = ResolveTarget(item);
            return new BackgroundTaskRequest(taskType, entityId, item.Title);
        }).ToList();

        var result = await _taskCoordinator.EnqueueBatchAsync(requests, cancellationToken);

        return ApiResponse<BatchEmbeddingResultDto>.Ok(new BatchEmbeddingResultDto
        {
            TotalUnindexed = unindexedItems.Count,
            QueuedCount = result.QueuedCount,
            SkippedCount = result.SkippedCount,
        });
    }

    /// <summary>
    /// 语义搜索测试
    /// </summary>
    [HttpPost("search")]
    public async Task<ApiResponse<PagedResult<NoteSearchResultDto>>> TestSearch(
        [FromBody] KnowledgeBaseSearchRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Query))
            return ApiResponse<PagedResult<NoteSearchResultDto>>.Fail("查询内容不能为空");

        var result = await _semanticSearchService.SearchAsync(request.Query, request.TopK, cancellationToken);
        return result;
    }

    /// <summary>
    /// 获取指定知识项的分块列表
    /// </summary>
    [HttpGet("chunks/{id:guid}")]
    public async Task<ApiResponse<List<NoteChunkDto>>> GetChunks(Guid id, CancellationToken cancellationToken)
    {
        var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, cancellationToken);
        if (item == null)
            return ApiResponse<List<NoteChunkDto>>.Fail("知识项不存在");

        var chunks = await _unitOfWork.KnowledgeItems.GetChunksAsync(id, cancellationToken);
        var embeddedChunkIds = (await _unitOfWork.KnowledgeItems.GetEmbeddedChunkIdsAsync(id, cancellationToken)).ToHashSet();

        var result = chunks.Select(chunk => new NoteChunkDto
        {
            Id = chunk.Id,
            KnowledgeItemId = chunk.KnowledgeItemId,
            ChunkIndex = chunk.ChunkIndex,
            Content = chunk.Content,
            Summary = chunk.Summary,
            ChunkMethod = chunk.ChunkMethod,
            HasEmbedding = embeddedChunkIds.Contains(chunk.Id),
            CreatedAt = chunk.CreatedAt,
            UpdatedAt = chunk.UpdatedAt
        }).ToList();

        return ApiResponse<List<NoteChunkDto>>.Ok(result);
    }
}

// ── Request / DTO ──

public class KnowledgeBaseSearchRequest
{
    public string Query { get; set; } = string.Empty;
    public int TopK { get; set; } = 10;
}

public class KnowledgeBaseStatusDto
{
    public int TotalItems { get; set; }
    public int IndexedItems { get; set; }
    public int UnindexedItems { get; set; }
    public int NoteCount { get; set; }
    public int FileCount { get; set; }
    public int UrlCount { get; set; }
    public bool HasEmbeddingProvider { get; set; }
    public int Dimensions { get; set; }
    /// <summary>正在运行的后台任务数（Queued + Running）</summary>
    public int RunningTaskCount { get; set; }
}

public class KnowledgeItemEmbeddingStatusDto
{
    public Guid Id { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? SourceUrl { get; set; }
    public string? FileName { get; set; }
    public long? FileSize { get; set; }
    public Guid? NoteId { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public bool HasEmbedding { get; set; }
    public string? EmbeddingModel { get; set; }
    public int EmbeddingDimensions { get; set; }
    public DateTimeOffset? EmbeddingUpdatedAt { get; set; }
    public int ChunkCount { get; set; }
    /// <summary>是否有正在进行的索引任务</summary>
    public bool HasRunningTask { get; set; }
}

public class BatchEmbeddingResultDto
{
    public int TotalUnindexed { get; set; }
    public int QueuedCount { get; set; }
    /// <summary>因已有进行中任务而跳过的数量</summary>
    public int SkippedCount { get; set; }
}
