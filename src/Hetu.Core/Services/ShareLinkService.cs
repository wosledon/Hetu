using System.Security.Cryptography;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Http;

namespace Hetu.Core.Services;

public class ShareLinkService : IShareLinkService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public ShareLinkService(IUnitOfWork unitOfWork, IHttpContextAccessor httpContextAccessor)
    {
        _unitOfWork = unitOfWork;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task<ApiResponse<ShareLinkDto>> CreateAsync(CreateShareLinkRequest request, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(request.NoteId, cancellationToken);
        if (note == null) return ApiResponse<ShareLinkDto>.Fail("笔记不存在");
        if (note.IsDeleted) return ApiResponse<ShareLinkDto>.Fail("已删除的笔记无法分享");

        var shareCode = GenerateShareCode();
        var shareLink = new ShareLink
        {
            Id = Guid.NewGuid(),
            NoteId = request.NoteId,
            ShareCode = shareCode,
            ExpiresAt = request.ExpiresInHours.HasValue
                ? DateTimeOffset.UtcNow.AddHours(request.ExpiresInHours.Value)
                : null,
            ViewCount = 0,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.ShareLinks.AddAsync(shareLink, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse<ShareLinkDto>.Ok(Map(shareLink));
    }

    public async Task<ApiResponse<List<ShareLinkDto>>> GetByNoteAsync(Guid noteId, CancellationToken cancellationToken = default)
    {
        var links = await _unitOfWork.ShareLinks.FindAsync(l => l.NoteId == noteId, cancellationToken);
        var dtos = links.Select(Map).ToList();
        return ApiResponse<List<ShareLinkDto>>.Ok(dtos);
    }

    public async Task<ApiResponse> DeactivateAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var link = await _unitOfWork.ShareLinks.GetByIdAsync(id, cancellationToken);
        if (link == null) return ApiResponse.Fail("分享链接不存在");

        link.IsActive = false;
        link.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.ShareLinks.UpdateAsync(link, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<SharedNoteDto>> GetSharedNoteAsync(string shareCode, CancellationToken cancellationToken = default)
    {
        var links = await _unitOfWork.ShareLinks.FindAsync(l => l.ShareCode == shareCode, cancellationToken);
        var link = links.FirstOrDefault();

        if (link == null) return ApiResponse<SharedNoteDto>.Fail("分享链接不存在");
        if (!link.IsActive) return ApiResponse<SharedNoteDto>.Fail("分享链接已失效");
        if (link.ExpiresAt.HasValue && link.ExpiresAt.Value < DateTimeOffset.UtcNow)
            return ApiResponse<SharedNoteDto>.Fail("分享链接已过期");

        var note = await _unitOfWork.Notes.GetByIdAsync(link.NoteId, cancellationToken);
        if (note == null || note.IsDeleted) return ApiResponse<SharedNoteDto>.Fail("笔记不存在或已删除");

        link.ViewCount++;
        link.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.ShareLinks.UpdateAsync(link, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse<SharedNoteDto>.Ok(new SharedNoteDto
        {
            Title = note.Title,
            Content = note.Content,
            CreatedAt = note.CreatedAt,
            UpdatedAt = note.UpdatedAt
        });
    }

    private static string GenerateShareCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(8);
        return Convert.ToBase64String(bytes)
            .Replace("+", "")
            .Replace("/", "")
            .Replace("=", "")
            [..10];
    }

    private ShareLinkDto Map(ShareLink link)
    {
        var request = _httpContextAccessor.HttpContext?.Request;
        var baseUrl = request != null ? $"{request.Scheme}://{request.Host}" : "";
        return new ShareLinkDto
        {
            Id = link.Id,
            NoteId = link.NoteId,
            ShareCode = link.ShareCode,
            ShareUrl = $"{baseUrl}/share/{link.ShareCode}",
            ExpiresAt = link.ExpiresAt,
            ViewCount = link.ViewCount,
            IsActive = link.IsActive,
            CreatedAt = link.CreatedAt
        };
    }
}
