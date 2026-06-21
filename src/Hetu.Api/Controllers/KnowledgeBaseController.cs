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
        var notes = await _unitOfWork.Notes.GetListAsync(includeDeleted: false, cancellationToken: cancellationToken);
        var embeddings = await _unitOfWork.Notes.GetAllEmbeddingsAsync(cancellationToken);

        var embeddingNoteIds = embeddings.Select(e => e.NoteId).ToHashSet();
        var indexedCount = notes.Count(n => embeddingNoteIds.Contains(n.Id));

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);

        var status = new KnowledgeBaseStatusDto
        {
            TotalNotes = notes.Count,
            IndexedNotes = indexedCount,
            UnindexedNotes = notes.Count - indexedCount,
            HasEmbeddingProvider = provider != null,
            Dimensions = provider?.Dimensions ?? 0,
        };

        return ApiResponse<KnowledgeBaseStatusDto>.Ok(status);
    }

    /// <summary>
    /// 获取所有笔记的 Embedding 状态列表
    /// </summary>
    [HttpGet("embeddings")]
    public async Task<ApiResponse<List<NoteEmbeddingStatusDto>>> GetEmbeddingStatuses(CancellationToken cancellationToken)
    {
        var notes = await _unitOfWork.Notes.GetListAsync(includeDeleted: false, cancellationToken: cancellationToken);
        var embeddings = await _unitOfWork.Notes.GetAllEmbeddingsAsync(cancellationToken);
        var embeddingMap = embeddings.ToDictionary(e => e.NoteId);

        var result = notes.Select(n => new NoteEmbeddingStatusDto
        {
            NoteId = n.Id,
            Title = n.Title,
            UpdatedAt = n.UpdatedAt,
            HasEmbedding = embeddingMap.ContainsKey(n.Id),
            EmbeddingModel = embeddingMap.TryGetValue(n.Id, out var emb) ? emb.Model : null,
            EmbeddingDimensions = embeddingMap.TryGetValue(n.Id, out var e2) ? e2.Dimensions : 0,
            EmbeddingUpdatedAt = embeddingMap.TryGetValue(n.Id, out var e3) ? e3.UpdatedAt : null,
        }).ToList();

        return ApiResponse<List<NoteEmbeddingStatusDto>>.Ok(result);
    }

    /// <summary>
    /// 为指定笔记生成 Embedding
    /// </summary>
    [HttpPost("embeddings/{noteId:guid}")]
    public async Task<ApiResponse> GenerateEmbedding(Guid noteId, CancellationToken cancellationToken)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null || note.IsDeleted)
            return ApiResponse.Fail("笔记不存在");

        await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateEmbedding, noteId), cancellationToken);
        return ApiResponse.Ok();
    }

    /// <summary>
    /// 批量为未索引笔记生成 Embedding
    /// </summary>
    [HttpPost("embeddings/batch")]
    public async Task<ApiResponse<BatchEmbeddingResultDto>> BatchGenerateEmbeddings(CancellationToken cancellationToken)
    {
        var notes = await _unitOfWork.Notes.GetListAsync(includeDeleted: false, cancellationToken: cancellationToken);
        var embeddings = await _unitOfWork.Notes.GetAllEmbeddingsAsync(cancellationToken);
        var embeddingNoteIds = embeddings.Select(e => e.NoteId).ToHashSet();

        var unindexedNotes = notes.Where(n => !embeddingNoteIds.Contains(n.Id)).ToList();
        var queued = 0;

        foreach (var note in unindexedNotes)
        {
            await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateEmbedding, note.Id), cancellationToken);
            queued++;
        }

        return ApiResponse<BatchEmbeddingResultDto>.Ok(new BatchEmbeddingResultDto
        {
            TotalUnindexed = unindexedNotes.Count,
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
}

public class KnowledgeBaseSearchRequest
{
    public string Query { get; set; } = string.Empty;
    public int TopK { get; set; } = 10;
}

public class KnowledgeBaseStatusDto
{
    public int TotalNotes { get; set; }
    public int IndexedNotes { get; set; }
    public int UnindexedNotes { get; set; }
    public bool HasEmbeddingProvider { get; set; }
    public int Dimensions { get; set; }
}

public class NoteEmbeddingStatusDto
{
    public Guid NoteId { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; }
    public bool HasEmbedding { get; set; }
    public string? EmbeddingModel { get; set; }
    public int EmbeddingDimensions { get; set; }
    public DateTimeOffset? EmbeddingUpdatedAt { get; set; }
}

public class BatchEmbeddingResultDto
{
    public int TotalUnindexed { get; set; }
    public int QueuedCount { get; set; }
}
