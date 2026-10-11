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
    private readonly ILocalizer _localizer;

    public KnowledgeBaseController(
        IUnitOfWork unitOfWork,
        ISemanticSearchService semanticSearchService,
        IEmbeddingProviderFactory embeddingProviderFactory,
        IBackgroundTaskCoordinator taskCoordinator,
        ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _semanticSearchService = semanticSearchService;
        _embeddingProviderFactory = embeddingProviderFactory;
        _taskCoordinator = taskCoordinator;
        _localizer = localizer;
    }

    /// <summary>笔记类知识项按笔记聚合索引，其余按知识项自身索引</summary>
    private static (BackgroundTaskType Type, Guid EntityId) ResolveTarget(KnowledgeItemType type, Guid id, Guid? noteId)
        => type == KnowledgeItemType.Note && noteId.HasValue
            ? (BackgroundTaskType.GenerateEmbedding, noteId.Value)
            : (BackgroundTaskType.GenerateKnowledgeItemEmbedding, id);

    /// <summary>
    /// 获取知识库状态概览
    /// </summary>
    [HttpGet("status")]
    [ResponseCache(Duration = 5)]
    public async Task<ApiResponse<KnowledgeBaseStatusDto>> GetStatus(CancellationToken cancellationToken)
    {
        // 全部走数据库聚合/计数：不再把所有知识项、所有分块向量、所有任务读进内存
        var counts = await _unitOfWork.KnowledgeItems.CountByTypeAsync(cancellationToken);
        var totalItems = counts.Values.Sum();
        var indexedCount = await _unitOfWork.KnowledgeItems.CountIndexedItemsAsync(cancellationToken);
        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);

        // 正在运行/排队的 Embedding 任务（SQL COUNT）
        var runningTaskCount = await _unitOfWork.TaskItems.CountAsync(t =>
            (t.Status == 0 || t.Status == 1) &&
            (t.TaskType == nameof(BackgroundTaskType.GenerateEmbedding) ||
             t.TaskType == nameof(BackgroundTaskType.GenerateKnowledgeItemEmbedding)), cancellationToken);

        var status = new KnowledgeBaseStatusDto
        {
            TotalItems = totalItems,
            IndexedItems = indexedCount,
            UnindexedItems = Math.Max(0, totalItems - indexedCount),
            NoteCount = counts.GetValueOrDefault(KnowledgeItemType.Note),
            FileCount = counts.GetValueOrDefault(KnowledgeItemType.File),
            UrlCount = counts.GetValueOrDefault(KnowledgeItemType.Url),
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
    [ResponseCache(Duration = 5)]
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

        // 分块向量按知识项聚合（每个知识项一行），不再加载全部分块明细
        var summaries = await _unitOfWork.KnowledgeItems.GetChunkEmbeddingSummariesAsync(cancellationToken);
        var chunkMap = summaries.ToDictionary(s => s.KnowledgeItemId);

        // 查询所有正在运行/排队的任务的实体 ID（只取 EntityId 一列）
        var runningEntityIds = (await _unitOfWork.TaskItems.SelectAsync(
            t => (t.Status == 0 || t.Status == 1) &&
                 (t.TaskType == nameof(BackgroundTaskType.GenerateEmbedding) ||
                  t.TaskType == nameof(BackgroundTaskType.GenerateKnowledgeItemEmbedding)),
            t => t.EntityId,
            cancellationToken)).ToHashSet();

        var result = items.Select(k =>
        {
            var entityId = k.Type == KnowledgeItemType.Note && k.NoteId.HasValue ? k.NoteId.Value : k.Id;
            chunkMap.TryGetValue(k.Id, out var summary);
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
                HasEmbedding = summary != null,
                EmbeddingModel = summary?.Model,
                EmbeddingDimensions = summary?.Dimensions ?? 0,
                EmbeddingUpdatedAt = summary?.UpdatedAt,
                ChunkCount = summary?.ChunkCount ?? 0,
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
            return ApiResponse.Fail(_localizer.T("knowledge.itemNotFound"));

        var (taskType, entityId) = ResolveTarget(item.Type, item.Id, item.NoteId);
        var result = await _taskCoordinator.EnqueueAsync(
            new BackgroundTaskRequest(taskType, entityId, item.Title),
            cancellationToken);

        if (!result.Queued)
            return ApiResponse.Fail(_localizer.T("knowledge.indexTaskRunning"));

        return ApiResponse.Ok();
    }

    /// <summary>
    /// 批量为未索引知识项生成 Embedding
    /// </summary>
    [HttpPost("embeddings/batch")]
    public async Task<ApiResponse<BatchEmbeddingResultDto>> BatchGenerateEmbeddings(CancellationToken cancellationToken)
    {
        // 未索引项在数据库侧判定（EXISTS 子查询 + 只取入队所需字段），不再把全部知识项与向量元数据读进内存。
        // 去重与并发保护由 IBackgroundTaskCoordinator 统一处理（只针对仍然存在的知识项，
        // 已删项留下的分块向量不会让它以为「已索引」）
        var unindexedItems = await _unitOfWork.KnowledgeItems.GetUnindexedAsync(cancellationToken: cancellationToken);
        var requests = unindexedItems.Select(item =>
        {
            var (taskType, entityId) = ResolveTarget(item.Type, item.Id, item.NoteId);
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
            return ApiResponse<PagedResult<NoteSearchResultDto>>.Fail(_localizer.T("knowledge.queryRequired"));

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
            return ApiResponse<List<NoteChunkDto>>.Fail(_localizer.T("knowledge.itemNotFound"));

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
