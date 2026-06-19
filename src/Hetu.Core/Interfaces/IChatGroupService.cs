using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IChatGroupService
{
    Task<ApiResponse<List<ChatGroupDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatGroupDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatGroupDto>> CreateAsync(CreateChatGroupRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatGroupDto>> UpdateAsync(Guid id, UpdateChatGroupRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
