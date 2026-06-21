using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class ChatTopicService : IChatTopicService
{
    private readonly IUnitOfWork _unitOfWork;

    public ChatTopicService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<ChatTopicDto>>> GetByGroupAsync(Guid groupId, CancellationToken cancellationToken = default)
    {
        var topics = await _unitOfWork.ChatTopics.FindAsync(t => t.GroupId == groupId, cancellationToken);
        return ApiResponse<List<ChatTopicDto>>.Ok(topics.OrderByDescending(t => t.UpdatedAt).Select(Map).ToList());
    }

    public async Task<ApiResponse<ChatTopicDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(id, cancellationToken);
        if (topic == null) return ApiResponse<ChatTopicDto>.Fail("话题不存在");
        return ApiResponse<ChatTopicDto>.Ok(Map(topic));
    }

    public async Task<ApiResponse<ChatTopicDto>> CreateAsync(CreateChatTopicRequest request, CancellationToken cancellationToken = default)
    {
        var group = await _unitOfWork.ChatGroups.GetByIdAsync(request.GroupId, cancellationToken);
        if (group == null) return ApiResponse<ChatTopicDto>.Fail("会话组不存在");

        var topic = new ChatTopic
        {
            Id = Guid.NewGuid(),
            GroupId = request.GroupId,
            Title = string.IsNullOrWhiteSpace(request.Title) ? "新话题" : request.Title.Trim(),
            ModelId = request.ModelId,
            CustomSystemPrompt = request.CustomSystemPrompt,
            ContextWindowSize = request.ContextWindowSize,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.ChatTopics.AddAsync(topic, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ChatTopicDto>.Ok(Map(topic));
    }

    public async Task<ApiResponse<ChatTopicDto>> UpdateAsync(Guid id, UpdateChatTopicRequest request, CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(id, cancellationToken);
        if (topic == null) return ApiResponse<ChatTopicDto>.Fail("话题不存在");

        topic.Title = string.IsNullOrWhiteSpace(request.Title) ? topic.Title : request.Title.Trim();
        topic.ModelId = request.ModelId;
        topic.CustomSystemPrompt = request.CustomSystemPrompt;
        topic.ContextWindowSize = request.ContextWindowSize;
        if (!string.IsNullOrEmpty(request.NoteSyncStatus) && Enum.TryParse<NoteSyncStatus>(request.NoteSyncStatus, true, out var status))
            topic.NoteSyncStatus = status;
        if (request.IsAutoOrganizeEnabled.HasValue)
            topic.IsAutoOrganizeEnabled = request.IsAutoOrganizeEnabled.Value;
        topic.AutoOrganizeNotebookId = request.AutoOrganizeNotebookId;
        topic.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.ChatTopics.UpdateAsync(topic, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ChatTopicDto>.Ok(Map(topic));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(id, cancellationToken);
        if (topic == null) return ApiResponse.Fail("话题不存在");

        await _unitOfWork.ChatTopics.DeleteAsync(topic, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static ChatTopicDto Map(ChatTopic topic) => new()
    {
        Id = topic.Id,
        GroupId = topic.GroupId,
        Title = topic.Title,
        ModelId = topic.ModelId,
        CustomSystemPrompt = topic.CustomSystemPrompt,
        ContextWindowSize = topic.ContextWindowSize,
        NoteSyncStatus = topic.NoteSyncStatus.ToString().ToLower(),
        IsAutoOrganizeEnabled = topic.IsAutoOrganizeEnabled,
        AutoOrganizeNotebookId = topic.AutoOrganizeNotebookId,
        CreatedAt = topic.CreatedAt,
        UpdatedAt = topic.UpdatedAt
    };

    public async Task<ApiResponse<ChatTopicDto>> ForkAsync(Guid topicId, Guid? branchMessageId, CancellationToken cancellationToken = default)
    {
        var sourceTopic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, cancellationToken);
        if (sourceTopic == null) return ApiResponse<ChatTopicDto>.Fail("原话题不存在");

        var messages = await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId, cancellationToken);
        var orderedMessages = messages.OrderBy(m => m.CreatedAt).ToList();

        if (branchMessageId.HasValue)
        {
            var branchMsg = orderedMessages.FirstOrDefault(m => m.Id == branchMessageId.Value);
            if (branchMsg != null)
            {
                orderedMessages = orderedMessages.TakeWhile(m => m.Id != branchMessageId.Value).Append(branchMsg).ToList();
            }
        }

        var newTopic = new ChatTopic
        {
            Id = Guid.NewGuid(),
            GroupId = sourceTopic.GroupId,
            Title = sourceTopic.Title + " (分支)",
            ModelId = sourceTopic.ModelId,
            CustomSystemPrompt = sourceTopic.CustomSystemPrompt,
            ContextWindowSize = sourceTopic.ContextWindowSize,
            ParentTopicId = topicId,
            BranchMessageId = branchMessageId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.ChatTopics.AddAsync(newTopic, cancellationToken);

        foreach (var msg in orderedMessages)
        {
            var newMsg = new ChatMessage
            {
                Id = Guid.NewGuid(),
                TopicId = newTopic.Id,
                Role = msg.Role,
                Content = msg.Content,
                ModelId = msg.ModelId,
                CreatedAt = msg.CreatedAt,
                UpdatedAt = msg.UpdatedAt
            };
            await _unitOfWork.ChatMessages.AddAsync(newMsg, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ChatTopicDto>.Ok(Map(newTopic));
    }
}
