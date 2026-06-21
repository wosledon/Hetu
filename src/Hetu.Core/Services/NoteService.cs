using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

public class NoteService : INoteService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly IGraphService _graphService;
    private readonly ILogger<NoteService> _logger;

    public NoteService(IUnitOfWork unitOfWork, IBackgroundTaskQueue taskQueue, IGraphService graphService, ILogger<NoteService> logger)
    {
        _unitOfWork = unitOfWork;
        _taskQueue = taskQueue;
        _graphService = graphService;
        _logger = logger;
    }

    public async Task<ApiResponse<PagedResult<NoteDto>>> GetListAsync(GetNotesRequest request, CancellationToken cancellationToken = default)
    {
        var notes = await _unitOfWork.Notes.GetListAsync(
            request.NotebookId,
            request.TagId,
            request.IncludeDeleted,
            request.FilterNoNotebook,
            cancellationToken);

        var ordered = notes.ToList();

        var total = ordered.Count;
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Max(1, request.PageSize);
        var items = ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(Map)
            .ToList();

        return ApiResponse<PagedResult<NoteDto>>.Ok(new PagedResult<NoteDto>
        {
            Items = items,
            TotalCount = total,
            Page = page,
            PageSize = pageSize
        });
    }

    public async Task<ApiResponse<NoteDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdWithTagsAsync(id, cancellationToken);
        if (note == null) return ApiResponse<NoteDto>.Fail("笔记不存在");
        return ApiResponse<NoteDto>.Ok(Map(note));
    }

    public async Task<ApiResponse<NoteDto>> CreateAsync(CreateNoteRequest request, CancellationToken cancellationToken = default)
    {
        var note = new Note
        {
            Id = Guid.NewGuid(),
            Title = string.IsNullOrWhiteSpace(request.Title) ? "未命名笔记" : request.Title.Trim(),
            Content = request.Content ?? string.Empty,
            NotebookId = request.NotebookId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Notes.AddAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateEmbedding, note.Id, note.Title), cancellationToken);

        return ApiResponse<NoteDto>.Ok(Map(note));
    }

    public async Task<ApiResponse<NoteDto>> UpdateAsync(Guid id, UpdateNoteRequest request, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdWithTagsAsync(id, cancellationToken);
        if (note == null) return ApiResponse<NoteDto>.Fail("笔记不存在");
        if (note.IsDeleted) return ApiResponse<NoteDto>.Fail("已删除的笔记无法编辑");

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

        // 通过 Channel 队列入队后台任务
        await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GenerateEmbedding, note.Id, note.Title), cancellationToken);

        // 按设置决定是否自动提取知识图谱
        var autoExtractSetting = await _unitOfWork.AppSettings.GetByKeyAsync("GraphAutoExtract", cancellationToken);
        if (autoExtractSetting?.Value == "true")
        {
            await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.GraphExtract, note.Id, note.Title), cancellationToken);
        }

        return ApiResponse<NoteDto>.Ok(Map(note));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail("笔记不存在");
        if (note.IsDeleted) return ApiResponse.Fail("笔记已在回收站");

        // 移入回收站时清理关联的知识图谱数据
        await _graphService.CleanUpByNoteIdAsync(id, cancellationToken);

        await _unitOfWork.Notes.SoftDeleteAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> RestoreAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail("笔记不存在");
        if (!note.IsDeleted) return ApiResponse.Fail("笔记未删除");

        // 恢复该笔记关联的知识图谱数据
        await _graphService.RestoreByNoteIdAsync(id, cancellationToken);

        await _unitOfWork.Notes.RestoreAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> HardDeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail("笔记不存在");

        // 先清理该笔记关联的知识图谱数据
        await _graphService.CleanUpByNoteIdAsync(id, cancellationToken);

        await _unitOfWork.Notes.HardDeleteAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> MoveAsync(Guid id, MoveNoteRequest request, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(id, cancellationToken);
        if (note == null) return ApiResponse.Fail("笔记不存在");

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

        var versions = (await _unitOfWork.NoteVersions.FindAsync(v => v.NoteId == note.Id, cancellationToken))
            .OrderByDescending(v => v.CreatedAt)
            .ToList();

        if (versions.Count > 20)
        {
            foreach (var old in versions.Skip(20))
            {
                await _unitOfWork.NoteVersions.DeleteAsync(old, cancellationToken);
            }
        }
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
            Id = nt.Tag.Id,
            Name = nt.Tag.Name,
            Color = nt.Tag.Color,
            CreatedAt = nt.Tag.CreatedAt
        }).ToList() ?? []
    };
}
