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
    private readonly IBackgroundTaskQueue _taskQueue;

    public KnowledgeBaseController(
        IUnitOfWork unitOfWork,
        ISemanticSearchService semanticSearchService,
        IEmbeddingProviderFactory embeddingProviderFactory,
        IBackgroundTaskQueue taskQueue)
    {
        _unitOfWork = unitOfWork;
        _semanticSearchService = semanticSearchService;
        _embeddingProviderFactory = embeddingProviderFactory;
        _taskQueue = taskQueue;
    }

    /// <summary>
    /// 获取知识库状态概览
    /// </summary>
    [HttpGet("status")]
    public async Task<ApiResponse<KnowledgeBaseStatusDto>> GetStatus(CancellationToken cancellationToken)
    {
        var allItems = await _unitOfWork.KnowledgeItems.GetAllAsync(cancellationToken);
        var chunkEmbeddings = await _unitOfWork.KnowledgeItems.GetAllChunkEmbeddingsAsync(cancellationToken);

        var indexedItemIds = chunkEmbeddings
            .Select(ce => ce.Chunk.KnowledgeItemId)
            .Distinct()
            .ToHashSet();

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);

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

        var chunkEmbeddings = await _unitOfWork.KnowledgeItems.GetAllChunkEmbeddingsAsync(cancellationToken);

        // 按知识项分组 chunk embeddings
        var chunkMap = chunkEmbeddings
            .GroupBy(ce => ce.Chunk.KnowledgeItemId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var result = items.Select(k => new KnowledgeItemEmbeddingStatusDto
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

        if (item.Type == KnowledgeItemType.Note && item.NoteId.HasValue)
        {
            await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateEmbedding, item.NoteId.Value), cancellationToken);
        }
        else
        {
            await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateKnowledgeItemEmbedding, id), cancellationToken);
        }
        return ApiResponse.Ok();
    }

    /// <summary>
    /// 批量为未索引知识项生成 Embedding
    /// </summary>
    [HttpPost("embeddings/batch")]
    public async Task<ApiResponse<BatchEmbeddingResultDto>> BatchGenerateEmbeddings(CancellationToken cancellationToken)
    {
        var allItems = await _unitOfWork.KnowledgeItems.GetAllAsync(cancellationToken);
        var chunkEmbeddings = await _unitOfWork.KnowledgeItems.GetAllChunkEmbeddingsAsync(cancellationToken);

        var indexedItemIds = chunkEmbeddings
            .Select(ce => ce.Chunk.KnowledgeItemId)
            .Distinct()
            .ToHashSet();

        var unindexedItems = allItems.Where(k => !indexedItemIds.Contains(k.Id)).ToList();
        var queued = 0;

        foreach (var item in unindexedItems)
        {
            if (item.Type == KnowledgeItemType.Note && item.NoteId.HasValue)
            {
                await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateEmbedding, item.NoteId.Value), cancellationToken);
            }
            else
            {
                await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateKnowledgeItemEmbedding, item.Id), cancellationToken);
            }
            queued++;
        }

        return ApiResponse<BatchEmbeddingResultDto>.Ok(new BatchEmbeddingResultDto
        {
            TotalUnindexed = unindexedItems.Count,
            QueuedCount = queued,
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
        var result = new List<NoteChunkDto>();
        foreach (var chunk in chunks)
        {
            var embedding = await _unitOfWork.KnowledgeItems.GetChunkEmbeddingAsync(chunk.Id, cancellationToken);
            result.Add(new NoteChunkDto
            {
                Id = chunk.Id,
                KnowledgeItemId = chunk.KnowledgeItemId,
                ChunkIndex = chunk.ChunkIndex,
                Content = chunk.Content,
                Summary = chunk.Summary,
                ChunkMethod = chunk.ChunkMethod,
                HasEmbedding = embedding != null,
                CreatedAt = chunk.CreatedAt,
                UpdatedAt = chunk.UpdatedAt
            });
        }

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
}

public class BatchEmbeddingResultDto
{
    public int TotalUnindexed { get; set; }
    public int QueuedCount { get; set; }
}
