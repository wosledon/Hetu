using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class ChatGroupService : IChatGroupService
{
    private readonly IUnitOfWork _unitOfWork;

    public ChatGroupService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<ChatGroupDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var groups = await _unitOfWork.ChatGroups.GetAllAsync(cancellationToken);
        return ApiResponse<List<ChatGroupDto>>.Ok(groups.OrderBy(g => g.SortOrder).ThenBy(g => g.Name).Select(Map).ToList());
    }

    public async Task<ApiResponse<ChatGroupDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var group = await _unitOfWork.ChatGroups.GetByIdAsync(id, cancellationToken);
        if (group == null) return ApiResponse<ChatGroupDto>.Fail("会话组不存在");
        return ApiResponse<ChatGroupDto>.Ok(Map(group));
    }

    public async Task<ApiResponse<ChatGroupDto>> CreateAsync(CreateChatGroupRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return ApiResponse<ChatGroupDto>.Fail("名称不能为空");

        var group = new ChatGroup
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description,
            Color = request.Color,
            Icon = request.Icon,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.ChatGroups.AddAsync(group, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ChatGroupDto>.Ok(Map(group));
    }

    public async Task<ApiResponse<ChatGroupDto>> UpdateAsync(Guid id, UpdateChatGroupRequest request, CancellationToken cancellationToken = default)
    {
        var group = await _unitOfWork.ChatGroups.GetByIdAsync(id, cancellationToken);
        if (group == null) return ApiResponse<ChatGroupDto>.Fail("会话组不存在");

        group.Name = string.IsNullOrWhiteSpace(request.Name) ? group.Name : request.Name.Trim();
        group.Description = request.Description;
        group.Color = request.Color;
        group.Icon = request.Icon;
        group.SortOrder = request.SortOrder;
        group.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.ChatGroups.UpdateAsync(group, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ChatGroupDto>.Ok(Map(group));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var group = await _unitOfWork.ChatGroups.GetByIdAsync(id, cancellationToken);
        if (group == null) return ApiResponse.Fail("会话组不存在");

        await _unitOfWork.ChatGroups.DeleteAsync(group, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static ChatGroupDto Map(ChatGroup group) => new()
    {
        Id = group.Id,
        Name = group.Name,
        Description = group.Description,
        Color = group.Color,
        Icon = group.Icon,
        SortOrder = group.SortOrder,
        CreatedAt = group.CreatedAt,
        UpdatedAt = group.UpdatedAt
    };
}
