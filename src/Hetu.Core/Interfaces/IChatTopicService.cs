using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IChatTopicService
{
    Task<ApiResponse<List<ChatTopicDto>>> GetByGroupAsync(Guid groupId, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatTopicDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatTopicDto>> CreateAsync(CreateChatTopicRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatTopicDto>> UpdateAsync(Guid id, UpdateChatTopicRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatTopicDto>> ForkAsync(Guid topicId, Guid? branchMessageId, CancellationToken cancellationToken = default);
}
