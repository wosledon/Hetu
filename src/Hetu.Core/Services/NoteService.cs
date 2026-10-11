using System.Linq;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

public class NoteService : INoteService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IBackgroundTaskCoordinator _taskCoordinator;
    private readonly IGraphService _graphService;
    private readonly ILocalizer _localizer;
    private readonly ILogger<NoteService> _logger;

    public NoteService(IUnitOfWork unitOfWork, IBackgroundTaskCoordinator taskCoordinator, IGraphService graphService, ILocalizer localizer, ILogger<NoteService> logger)
    {
        _unitOfWork = unitOfWork;
        _taskCoordinator = taskCoordinator;
        _graphService = graphService;
        _localizer = localizer;
        _logger = logger;
    }

    public async Task<ApiResponse<PagedResult<NoteDto>>> GetListAsync(GetNotesRequest request, CancellationToken cancellationToken = default)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Max(1, request.PageSize);

        // 分页下推到数据库（SQL COUNT + OFFSET/FETCH）：数据量大时不再把全部笔记读进内存
        var (notes, total) = await _unitOfWork.Notes.GetPagedAsync(
            request.NotebookId,
            request.TagId,
            request.IncludeDeleted,
            request.FilterNoNotebook,
            skip: (page - 1) * pageSize,
            take: pageSize,
            cancellationToken);

        return ApiResponse<PagedResult<NoteDto>>.Ok(new PagedResult<NoteDto>
        {
            Items = notes.Select(Map).ToList(),
            TotalCount = total,
            Page = page,
            PageSize = pageSize
        });
    }

    public async Task<ApiResponse<NoteDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdWithTagsAsync(id, cancellationToken);
        if (note == null) return ApiResponse<NoteDto>.Fail(_localizer.T("note.notFound"));
        return ApiResponse<NoteDto>.Ok(Map(note));
    }

    public async Task<ApiResponse<NoteDto>> CreateAsync(CreateNoteRequest request, CancellationToken cancellationToken = default)
    {
        var note = new Note
        {
            Id = Guid.NewGuid(),
            Title = string.IsNullOrWhiteSpace(request.Title) ? _localizer.T("note.untitled") : request.Title.Trim(),
            Content = request.Content ?? string.Empty,
            NotebookId = request.NotebookId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Notes.AddAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 按设置决定是否自动生成 Embedding
        var autoEmbeddingSetting = await _unitOfWork.AppSettings.GetByKeyAsync("AutoEmbedding", cancellationToken);
        if (autoEmbeddingSetting?.Value == "true")
        {
            await QueueIfNotRunningAsync(BackgroundTaskType.GenerateEmbedding, note.Id, note.Title, cancellationToken);
        }

        return ApiResponse<NoteDto>.Ok(Map(note));
    }

    public async Task<ApiResponse<NoteDto>> UpdateAsync(Guid id, UpdateNoteRequest request, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdWithTagsAsync(id, cancellationToken);
        if (note == null) return ApiResponse<NoteDto>.Fail(_localizer.T("note.notFound"));
        if (note.IsDeleted) return ApiResponse<NoteDto>.Fail(_localizer.T("note.deletedCannotEdit"));

        var hasContentChange = request.Title != null || request.Content != null;
        if (hasContentChange)
        {
            await SaveVersionAsync(note, cancellationToken);
        }

        if (request.Title != null)
            note.Title = string.IsNullOrWhiteSpace(request.Title) ? note.Title : request.Title.Trim();
        if (request.Content != null)
            note.Content = request.Content;
        if (request.NotebookId.HasValue)
            note.NotebookId = request.NotebookId;
        if (request.IsFavorite.HasValue)
            note.IsFavorite = request.IsFavorite.Value;
        if (request.IsPinned.HasValue)
            note.IsPinned = request.IsPinned.Value;

        note.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Notes.UpdateAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 按设置决定是否自动生成 Embedding
        var autoEmbeddingSetting = await _unitOfWork.AppSettings.GetByKeyAsync("AutoEmbedding", cancellationToken);
        if (autoEmbeddingSetting?.Value == "true")
        {
            await QueueIfNotRunningAsync(BackgroundTaskType.GenerateEmbedding, note.Id, note.Title, cancellationToken);
        }

        // 按设置决定是否自动提取知识图谱
        var autoExtractSetting = await _unitOfWork.AppSettings.GetByKeyAsync("GraphAutoExtract", cancellationToken);
        if (autoExtractSetting?.Value == "true")
        {
            await QueueIfNotRunningAsync(BackgroundTaskType.GraphExtract, note.Id, note.Title, cancellationToken);
        }

        return ApiResponse<NoteDto>.Ok(Map(note));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail(_localizer.T("note.notFound"));
        if (note.IsDeleted) return ApiResponse.Fail(_localizer.T("note.inTrash"));

        // 移入回收站时清理关联的知识图谱数据
        await _graphService.CleanUpByNoteIdAsync(id, cancellationToken);

        // 软删除关联的 KnowledgeItem
        var knowledgeItem = await _unitOfWork.KnowledgeItems.GetByNoteIdAsync(id, cancellationToken);
        if (knowledgeItem != null)
        {
            knowledgeItem.IsDeleted = true;
            knowledgeItem.DeletedAt = DateTimeOffset.UtcNow;
            knowledgeItem.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.KnowledgeItems.UpdateAsync(knowledgeItem, cancellationToken);
        }

        // 删除 NoteEmbedding（NoteEmbedding 无 IsDeleted，直接物理删除）
        await _unitOfWork.Notes.DeleteEmbeddingAsync(id, cancellationToken);

        await _unitOfWork.Notes.SoftDeleteAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> RestoreAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail(_localizer.T("note.notFound"));
        if (!note.IsDeleted) return ApiResponse.Fail(_localizer.T("note.notDeleted"));

        // 恢复该笔记关联的知识图谱数据
        await _graphService.RestoreByNoteIdAsync(id, cancellationToken);

        // 恢复关联的 KnowledgeItem（已被软删除，需要忽略查询过滤器）
        var items = await _unitOfWork.KnowledgeItems.FindIgnoreQueryFilterAsync(k => k.NoteId == id, cancellationToken);
        var knowledgeItem = items.FirstOrDefault();
        if (knowledgeItem != null)
        {
            knowledgeItem.IsDeleted = false;
            knowledgeItem.DeletedAt = null;
            knowledgeItem.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.KnowledgeItems.UpdateAsync(knowledgeItem, cancellationToken);
        }

        await _unitOfWork.Notes.RestoreAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 恢复后重建 Embedding
        var autoEmbeddingSetting = await _unitOfWork.AppSettings.GetByKeyAsync("AutoEmbedding", cancellationToken);
        if (autoEmbeddingSetting?.Value == "true")
        {
            await QueueIfNotRunningAsync(BackgroundTaskType.GenerateEmbedding, note.Id, note.Title, cancellationToken);
        }

        // 删除时孤儿实体已被清理，恢复后重新提取以重建图谱
        var autoExtractSetting = await _unitOfWork.AppSettings.GetByKeyAsync("GraphAutoExtract", cancellationToken);
        if (autoExtractSetting?.Value == "true")
        {
            await QueueIfNotRunningAsync(BackgroundTaskType.GraphExtract, note.Id, note.Title, cancellationToken);
        }

        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> HardDeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail(_localizer.T("note.notFound"));

        // 先清理该笔记关联的知识图谱数据
        await _graphService.CleanUpByNoteIdAsync(id, cancellationToken);

        // 删除关联的 KnowledgeItem 及其 chunks（Note-KnowledgeItem 是 SetNull，不会级联删除）
        var knowledgeItem = await _unitOfWork.KnowledgeItems.GetByNoteIdAsync(id, cancellationToken);
        if (knowledgeItem != null)
        {
            await _unitOfWork.KnowledgeItems.DeleteChunksAsync(knowledgeItem.Id, cancellationToken);
            await _unitOfWork.KnowledgeItems.DeleteAsync(knowledgeItem, cancellationToken);
        }

        // NoteEmbedding 由 FK 级联删除，无需手动处理

        await _unitOfWork.Notes.HardDeleteAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> MoveAsync(Guid id, MoveNoteRequest request, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail(_localizer.T("note.notFound"));

        note.NotebookId = request.NotebookId;
        note.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Notes.UpdateAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private async Task SaveVersionAsync(Note note, CancellationToken cancellationToken)
    {
        var version = new NoteVersion
        {
            Id = Guid.NewGuid(),
            NoteId = note.Id,
            Title = note.Title,
            Content = note.Content,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.NoteVersions.AddAsync(version, cancellationToken);
        // 先落库：PruneAsync 走 SQL DELETE，看不到尚未提交的新版本
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 保留最近 20 个版本：数据库侧一次清理，不再把全部历史版本读进内存
        await _unitOfWork.NoteVersions.PruneAsync(v => v.NoteId == note.Id, v => v.CreatedAt, 20, cancellationToken);
    }

    private static NoteDto Map(Note note) => new()
    {
        Id = note.Id,
        NotebookId = note.NotebookId,
        Title = note.Title,
        Content = note.Content,
        IsDeleted = note.IsDeleted,
        IsFavorite = note.IsFavorite,
        IsPinned = note.IsPinned,
        DeletedAt = note.DeletedAt,
        CreatedAt = note.CreatedAt,
        UpdatedAt = note.UpdatedAt,
        Tags = note.NoteTags?.Select(nt => new TagDto
        {
            Id = nt.Tag!.Id,
            Name = nt.Tag!.Name,
            Color = nt.Tag.Color,
            CreatedAt = nt.Tag.CreatedAt
        }).ToList() ?? []
    };

    /// <summary>
    /// 仅在无进行中任务时才入队，防止重复触发
    /// </summary>
    private async Task QueueIfNotRunningAsync(BackgroundTaskType taskType, Guid entityId, string? metadata, CancellationToken ct)
    {
        var result = await _taskCoordinator.EnqueueAsync(new BackgroundTaskRequest(taskType, entityId, metadata), ct);
        if (!result.Queued)
            _logger.LogDebug("跳过重复任务: {TaskType}({EntityId}), 已有进行中任务", taskType, entityId);
    }
}
