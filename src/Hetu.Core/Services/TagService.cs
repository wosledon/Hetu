using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class TagService : ITagService
{
    private readonly IUnitOfWork _unitOfWork;

    public TagService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<TagDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var tags = await _unitOfWork.Tags.GetAllAsync(cancellationToken);
        var counts = await _unitOfWork.Tags.GetNoteCountsAsync(cancellationToken);
        return ApiResponse<List<TagDto>>.Ok(tags.Select(t => Map(t, counts.GetValueOrDefault(t.Id))).ToList());
    }

    public async Task<ApiResponse<TagDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var tag = await _unitOfWork.Tags.GetByIdAsync(id, cancellationToken);
        if (tag == null) return ApiResponse<TagDto>.Fail("标签不存在");
        return ApiResponse<TagDto>.Ok(Map(tag));
    }

    public async Task<ApiResponse<TagDto>> CreateAsync(CreateTagRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return ApiResponse<TagDto>.Fail("标签名称不能为空");

        var normalized = request.Name.Trim().ToLowerInvariant();
        var existing = await _unitOfWork.Tags.GetByNameAsync(normalized, cancellationToken);
        if (existing != null) return ApiResponse<TagDto>.Fail("标签已存在");

        var tag = new Tag
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Color = request.Color,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Tags.AddAsync(tag, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<TagDto>.Ok(Map(tag));
    }

    public async Task<ApiResponse<TagDto>> UpdateAsync(Guid id, UpdateTagRequest request, CancellationToken cancellationToken = default)
    {
        var tag = await _unitOfWork.Tags.GetByIdAsync(id, cancellationToken);
        if (tag == null) return ApiResponse<TagDto>.Fail("标签不存在");

        tag.Name = string.IsNullOrWhiteSpace(request.Name) ? tag.Name : request.Name.Trim();
        tag.Color = request.Color;
        tag.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Tags.UpdateAsync(tag, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<TagDto>.Ok(Map(tag));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var tag = await _unitOfWork.Tags.GetByIdAsync(id, cancellationToken);
        if (tag == null) return ApiResponse.Fail("标签不存在");

        await _unitOfWork.Tags.DeleteAsync(tag, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> MergeAsync(MergeTagsRequest request, CancellationToken cancellationToken = default)
    {
        var target = await _unitOfWork.Tags.GetByIdAsync(request.TargetTagId, cancellationToken);
        if (target == null) return ApiResponse.Fail("目标标签不存在");

        foreach (var sourceId in request.SourceTagIds)
        {
            if (sourceId == request.TargetTagId) continue;

            var noteIds = await _unitOfWork.Notes.GetNoteIdsByTagAsync(sourceId, cancellationToken);
            if (noteIds.Count > 0)
            {
                await _unitOfWork.Notes.AddTagToNotesAsync(request.TargetTagId, noteIds, cancellationToken);
                await _unitOfWork.Notes.RemoveTagFromNotesAsync(sourceId, noteIds, cancellationToken);
            }

            var source = await _unitOfWork.Tags.GetByIdAsync(sourceId, cancellationToken);
            if (source != null)
            {
                await _unitOfWork.Tags.DeleteAsync(source, cancellationToken);
            }
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<List<TagDto>>> GetByNoteAsync(Guid noteId, CancellationToken cancellationToken = default)
    {
        var tags = await _unitOfWork.Tags.GetByNoteAsync(noteId, cancellationToken);
        return ApiResponse<List<TagDto>>.Ok(tags.Select(Map).ToList());
    }

    public async Task<ApiResponse> SetNoteTagsAsync(Guid noteId, ManageNoteTagsRequest request, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null) return ApiResponse.Fail("笔记不存在");

        await _unitOfWork.Notes.SetTagsAsync(noteId, request.TagIds, cancellationToken);

        note.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.Notes.UpdateAsync(note, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static TagDto Map(Tag tag, int noteCount = 0) => new()
    {
        Id = tag.Id,
        Name = tag.Name,
        Color = tag.Color,
        CreatedAt = tag.CreatedAt,
        NoteCount = noteCount
    };
}
