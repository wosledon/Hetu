using Hetu.Core.Entities;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IChatMessageService
{
    Task<ApiResponse<List<ChatMessageDto>>> GetByTopicAsync(Guid topicId, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatMessageDto>> CreateUserMessageAsync(Guid topicId, string content, CancellationToken cancellationToken = default);
    Task<ApiResponse<ChatMessageDto>> UpdateAsync(Guid id, UpdateChatMessageRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ChatMessage?> SaveAssistantMessageAsync(Guid topicId, string content, Guid? modelId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ChatMessage>> BuildHistoryAsync(Guid topicId, int? contextWindowSize, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<ChatMessageSearchResultDto>>> SearchAsync(string keyword, Guid? topicId = null, Guid? groupId = null, CancellationToken cancellationToken = default);
}

public class ChatMessageSearchResultDto
{
    public Guid Id { get; set; }
    public Guid TopicId { get; set; }
    public string TopicTitle { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string ContentSnippet { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}
