using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class NoteVersionService : INoteVersionService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly INoteService _noteService;
    private readonly ILocalizer _localizer;

    public NoteVersionService(IUnitOfWork unitOfWork, INoteService noteService, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _noteService = noteService;
        _localizer = localizer;
    }

    public async Task<ApiResponse<List<NoteVersionDto>>> GetVersionsAsync(Guid noteId, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null) return ApiResponse<List<NoteVersionDto>>.Fail(_localizer.T("note.notFound"));

        var versions = await _unitOfWork.NoteVersions.FindAsync(v => v.NoteId == noteId, cancellationToken);
        return ApiResponse<List<NoteVersionDto>>.Ok(
            versions.OrderByDescending(v => v.CreatedAt).Select(Map).ToList());
    }

    public async Task<ApiResponse<NoteVersionDto>> GetVersionAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var version = await _unitOfWork.NoteVersions.GetByIdAsync(id, cancellationToken);
        if (version == null) return ApiResponse<NoteVersionDto>.Fail(_localizer.T("noteVersion.notFound"));
        return ApiResponse<NoteVersionDto>.Ok(Map(version));
    }

    public async Task<ApiResponse<NoteDto>> RestoreVersionAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var version = await _unitOfWork.NoteVersions.GetByIdAsync(id, cancellationToken);
        if (version == null) return ApiResponse<NoteDto>.Fail(_localizer.T("noteVersion.notFound"));

        var note = await _unitOfWork.Notes.GetByIdWithTagsAsync(version.NoteId, cancellationToken);
        if (note == null) return ApiResponse<NoteDto>.Fail(_localizer.T("note.notFound"));
        if (note.IsDeleted) return ApiResponse<NoteDto>.Fail(_localizer.T("noteVersion.deletedCannotRestore"));

        // 先保存当前内容为最新版本
        await SaveVersionAsync(note, cancellationToken);

        note.Title = version.Title;
        note.Content = version.Content;
        note.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Notes.UpdateAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return await _noteService.GetByIdAsync(note.Id, cancellationToken);
    }

    public async Task SaveVersionAsync(Note note, CancellationToken cancellationToken = default)
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

        // 保留最近 20 个版本
        var versions = (await _unitOfWork.NoteVersions.FindAsync(v => v.NoteId == note.Id, cancellationToken))
            .OrderByDescending(v => v.CreatedAt)
            .ToList();

        if (versions.Count > 20)
        {
            var toDelete = versions.Skip(20).ToList();
            foreach (var old in toDelete)
            {
                await _unitOfWork.NoteVersions.DeleteAsync(old, cancellationToken);
            }
        }
    }

    private static NoteVersionDto Map(NoteVersion version) => new()
    {
        Id = version.Id,
        NoteId = version.NoteId,
        Title = version.Title,
        Content = version.Content,
        CreatedAt = version.CreatedAt
    };
}
