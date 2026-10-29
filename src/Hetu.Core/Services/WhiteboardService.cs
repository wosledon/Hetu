using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Whiteboard;

namespace Hetu.Core.Services;

public class WhiteboardService : IWhiteboardService
{
    /// <summary>名称上限（超出直接拒绝，避免无界字段）</summary>
    private const int MaxNameLength = 100;

    /// <summary>场景 JSON 上限（约 4 MB，SQLite / Postgres 文本列均可容纳）</summary>
    private const int MaxSceneLength = 4 * 1024 * 1024;

    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalizer _localizer;

    public WhiteboardService(IUnitOfWork unitOfWork, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
    }

    public async Task<ApiResponse<PagedResult<WhiteboardListItemDto>>> GetListAsync(int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var totalCount = await _unitOfWork.Whiteboards.CountAsync(w => !w.IsDeleted, cancellationToken);
        var boards = await _unitOfWork.Whiteboards.GetPagedByDateAsync(
            w => !w.IsDeleted,
            w => w.UpdatedAt,
            descending: true,
            skip: (page - 1) * pageSize,
            take: pageSize,
            cancellationToken);

        var items = boards.Select(w => new WhiteboardListItemDto
        {
            Id = w.Id,
            Name = w.Name,
            CreatedAt = w.CreatedAt,
            UpdatedAt = w.UpdatedAt
        }).ToList();

        return ApiResponse<PagedResult<WhiteboardListItemDto>>.Ok(new PagedResult<WhiteboardListItemDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        });
    }

    public async Task<ApiResponse<WhiteboardDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var board = await _unitOfWork.Whiteboards.GetByIdAsync(id, cancellationToken);
        if (board == null || board.IsDeleted) return ApiResponse<WhiteboardDto>.Fail(_localizer.T("whiteboard.notFound"));
        return ApiResponse<WhiteboardDto>.Ok(Map(board));
    }

    public async Task<ApiResponse<WhiteboardDto>> CreateAsync(CreateWhiteboardRequest request, CancellationToken cancellationToken = default)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length == 0) return ApiResponse<WhiteboardDto>.Fail(_localizer.T("whiteboard.nameRequired"));
        if (name.Length > MaxNameLength) return ApiResponse<WhiteboardDto>.Fail(_localizer.T("whiteboard.nameTooLong", MaxNameLength));

        var scene = string.IsNullOrWhiteSpace(request.Scene) ? "{}" : request.Scene;
        var sceneError = ValidateScene(scene);
        if (sceneError != null) return ApiResponse<WhiteboardDto>.Fail(sceneError);

        var now = DateTimeOffset.UtcNow;
        var board = new Whiteboard
        {
            Id = Guid.NewGuid(),
            Name = name,
            Scene = scene,
            IsDeleted = false,
            CreatedAt = now,
            UpdatedAt = now
        };

        await _unitOfWork.Whiteboards.AddAsync(board, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WhiteboardDto>.Ok(Map(board));
    }

    public async Task<ApiResponse<WhiteboardDto>> UpdateAsync(Guid id, UpdateWhiteboardRequest request, CancellationToken cancellationToken = default)
    {
        var board = await _unitOfWork.Whiteboards.GetByIdAsync(id, cancellationToken);
        if (board == null || board.IsDeleted) return ApiResponse<WhiteboardDto>.Fail(_localizer.T("whiteboard.notFound"));

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            var name = request.Name.Trim();
            if (name.Length > MaxNameLength) return ApiResponse<WhiteboardDto>.Fail(_localizer.T("whiteboard.nameTooLong", MaxNameLength));
            board.Name = name;
        }

        if (!string.IsNullOrWhiteSpace(request.Scene))
        {
            var sceneError = ValidateScene(request.Scene);
            if (sceneError != null) return ApiResponse<WhiteboardDto>.Fail(sceneError);
            board.Scene = request.Scene;
        }

        board.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.Whiteboards.UpdateAsync(board, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WhiteboardDto>.Ok(Map(board));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var board = await _unitOfWork.Whiteboards.GetByIdAsync(id, cancellationToken);
        if (board == null || board.IsDeleted) return ApiResponse.Fail(_localizer.T("whiteboard.notFound"));

        board.IsDeleted = true;
        board.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.Whiteboards.UpdateAsync(board, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    /// <summary>校验场景 JSON：必须是合法 JSON 对象且不超长；返回错误文案（合法时返回 null）</summary>
    private string? ValidateScene(string scene)
    {
        if (scene.Length > MaxSceneLength) return _localizer.T("whiteboard.sceneTooLarge");
        try
        {
            using var document = JsonDocument.Parse(scene);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                return _localizer.T("whiteboard.sceneInvalid");
            return null;
        }
        catch (JsonException)
        {
            return _localizer.T("whiteboard.sceneInvalid");
        }
    }

    private static WhiteboardDto Map(Whiteboard board) => new()
    {
        Id = board.Id,
        Name = board.Name,
        Scene = board.Scene,
        CreatedAt = board.CreatedAt,
        UpdatedAt = board.UpdatedAt
    };
}
