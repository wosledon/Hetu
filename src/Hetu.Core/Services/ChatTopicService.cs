using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class ChatTopicService : IChatTopicService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalizer _localizer;

    public ChatTopicService(IUnitOfWork unitOfWork, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
    }

    public async Task<ApiResponse<List<ChatTopicDto>>> GetByGroupAsync(Guid groupId, CancellationToken cancellationToken = default)
    {
        var topics = await _unitOfWork.ChatTopics.FindAsync(t => t.GroupId == groupId, cancellationToken);
        return ApiResponse<List<ChatTopicDto>>.Ok(topics.OrderByDescending(t => t.UpdatedAt).Select(Map).ToList());
    }

    public async Task<ApiResponse<ChatTopicDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(id, cancellationToken);
        if (topic == null) return ApiResponse<ChatTopicDto>.Fail(_localizer.T("chatTopic.notFound"));
        return ApiResponse<ChatTopicDto>.Ok(Map(topic));
    }

    public async Task<ApiResponse<ChatTopicDto>> CreateAsync(CreateChatTopicRequest request, CancellationToken cancellationToken = default)
    {
        var group = await _unitOfWork.ChatGroups.GetByIdAsync(request.GroupId, cancellationToken);
        if (group == null) return ApiResponse<ChatTopicDto>.Fail(_localizer.T("chatGroup.notFound"));
        if (group.IsMain) return ApiResponse<ChatTopicDto>.Fail(_localizer.T("chatTopic.mainCannotHaveSub"));

        var topic = new ChatTopic
        {
            Id = Guid.NewGuid(),
            GroupId = request.GroupId,
            Title = string.IsNullOrWhiteSpace(request.Title) ? _localizer.T("chatTopic.defaultTitle") : request.Title.Trim(),
            ModelId = request.ModelId,
            CustomSystemPrompt = request.CustomSystemPrompt,
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
        if (topic == null) return ApiResponse<ChatTopicDto>.Fail(_localizer.T("chatTopic.notFound"));

        topic.Title = string.IsNullOrWhiteSpace(request.Title) ? topic.Title : request.Title.Trim();
        topic.ModelId = request.ModelId;
        topic.CustomSystemPrompt = request.CustomSystemPrompt;
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
        if (topic == null) return ApiResponse.Fail(_localizer.T("chatTopic.notFound"));

        await _unitOfWork.ChatTopics.DeleteAsync(topic, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    /// <summary>
    /// 清空话题的全部消息：主对话全局唯一，累积的旧上下文会污染后续对话，需可一键清理。
    /// </summary>
    public async Task<ApiResponse> ClearAsync(Guid topicId, CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, cancellationToken);
        if (topic == null) return ApiResponse.Fail(_localizer.T("chatTopic.notFound"));

        var messages = await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId, cancellationToken);
        foreach (var message in messages)
        {
            await _unitOfWork.ChatMessages.DeleteAsync(message, cancellationToken);
        }

        // 消息清空后摘要随之失效，否则压缩摘要仍会作为上下文发送
        if (!string.IsNullOrWhiteSpace(topic.ContextSummary) || topic.ContextSummaryThroughMessageId != null)
        {
            topic.ContextSummary = null;
            topic.ContextSummaryThroughMessageId = null;
            await _unitOfWork.ChatTopics.UpdateAsync(topic, cancellationToken);
        }

        await _unitOfWork.ChatTopics.TouchUpdatedAtAsync(topicId, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static ChatTopicDto Map(ChatTopic topic) => MapTopic(topic);

    /// <summary>话题 → DTO 映射（供主对话等跨服务复用）</summary>
    public static ChatTopicDto MapTopic(ChatTopic topic) => new()
    {
        Id = topic.Id,
        GroupId = topic.GroupId,
        Title = topic.Title,
        ModelId = topic.ModelId,
        CustomSystemPrompt = topic.CustomSystemPrompt,
        NoteSyncStatus = topic.NoteSyncStatus.ToString().ToLower(),
        IsAutoOrganizeEnabled = topic.IsAutoOrganizeEnabled,
        AutoOrganizeNotebookId = topic.AutoOrganizeNotebookId,
        IsMain = topic.IsMain,
        CreatedAt = topic.CreatedAt,
        UpdatedAt = topic.UpdatedAt
    };

    public async Task<ApiResponse<ChatTopicDto>> ForkAsync(Guid topicId, Guid? branchMessageId, CancellationToken cancellationToken = default)
    {
        var sourceTopic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, cancellationToken);
        if (sourceTopic == null) return ApiResponse<ChatTopicDto>.Fail(_localizer.T("chatTopic.sourceNotFound"));

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
            Title = sourceTopic.Title + " " + _localizer.T("chatTopic.branchSuffix"),
            ModelId = sourceTopic.ModelId,
            CustomSystemPrompt = sourceTopic.CustomSystemPrompt,
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
