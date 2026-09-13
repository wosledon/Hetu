using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class ChatMessageService : IChatMessageService
{
    private readonly IUnitOfWork _unitOfWork;

    public ChatMessageService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<ChatMessageDto>>> GetByTopicAsync(Guid topicId, CancellationToken cancellationToken = default)
    {
        var messages = await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId, cancellationToken);
        return ApiResponse<List<ChatMessageDto>>.Ok(messages.OrderBy(m => m.CreatedAt).Select(Map).ToList());
    }

    public async Task<ApiResponse<ChatMessageDto>> CreateUserMessageAsync(Guid topicId, string content, CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, cancellationToken);
        if (topic == null) return ApiResponse<ChatMessageDto>.Fail("话题不存在");

        var message = new ChatMessage
        {
            Id = Guid.NewGuid(),
            TopicId = topicId,
            Role = "user",
            Content = content.Trim(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.ChatMessages.AddAsync(message, cancellationToken);

        // 如果是话题的第一条消息，自动设置标题
        if (topic.Title == "新话题")
        {
            var existingMessages = await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId && m.Id != message.Id, cancellationToken);
            if (existingMessages.Count == 0)
            {
                var title = content.Trim();
                if (title.Length > 50) title = title.Substring(0, 50) + "...";
                topic.Title = title;
                await _unitOfWork.ChatTopics.UpdateAsync(topic, cancellationToken);
            }
        }

        await _unitOfWork.ChatTopics.TouchUpdatedAtAsync(topicId, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse<ChatMessageDto>.Ok(Map(message));
    }

    public async Task<ApiResponse<ChatMessageDto>> UpdateAsync(Guid id, UpdateChatMessageRequest request, CancellationToken cancellationToken = default)
    {
        var message = await _unitOfWork.ChatMessages.GetByIdAsync(id, cancellationToken);
        if (message == null) return ApiResponse<ChatMessageDto>.Fail("消息不存在");
        if (string.IsNullOrWhiteSpace(request.Content)) return ApiResponse<ChatMessageDto>.Fail("消息内容不能为空");

        message.Content = request.Content.Trim();
        message.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.ChatMessages.UpdateAsync(message, cancellationToken);
        await _unitOfWork.ChatTopics.TouchUpdatedAtAsync(message.TopicId, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ChatMessageDto>.Ok(Map(message));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var message = await _unitOfWork.ChatMessages.GetByIdAsync(id, cancellationToken);
        if (message == null) return ApiResponse.Fail("消息不存在");

        var topicId = message.TopicId;
        await _unitOfWork.ChatMessages.DeleteAsync(message, cancellationToken);
        await _unitOfWork.ChatTopics.TouchUpdatedAtAsync(topicId, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ChatMessage?> SaveAssistantMessageAsync(Guid topicId, string content, Guid? modelId, string? thinkingContent = null, string? searchResultsJson = null, string? knowledgeResultsJson = null, string? memoryResultsJson = null, int? tokensUsed = null, int? cachedTokens = null, int? latencyMs = null, int? inputTokens = null, int? compressedTokens = null, int? outputTokens = null, CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, cancellationToken);
        if (topic == null) return null;

        var message = new ChatMessage
        {
            Id = Guid.NewGuid(),
            TopicId = topicId,
            Role = "assistant",
            Content = content,
            ModelId = modelId,
            ThinkingContent = thinkingContent,
            SearchResultsJson = searchResultsJson,
            KnowledgeResultsJson = knowledgeResultsJson,
            MemoryResultsJson = memoryResultsJson,
            TokensUsed = tokensUsed,
            CachedTokens = cachedTokens,
            LatencyMs = latencyMs,
            InputTokens = inputTokens,
            CompressedTokens = compressedTokens,
            OutputTokens = outputTokens,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.ChatMessages.AddAsync(message, cancellationToken);
        await _unitOfWork.ChatTopics.TouchUpdatedAtAsync(topicId, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return message;
    }

    public async Task<IReadOnlyList<ChatMessage>> BuildHistoryAsync(Guid topicId, int? contextWindowSize, CancellationToken cancellationToken = default)
    {
        var messages = (await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId, cancellationToken))
            .OrderBy(m => m.CreatedAt)
            .ToList();

        var limit = contextWindowSize ?? int.MaxValue;
        if (messages.Count > limit)
        {
            messages = messages.Skip(messages.Count - limit).ToList();
        }

        return messages;
    }

    private static ChatMessageDto Map(ChatMessage message) => new()
    {
        Id = message.Id,
        TopicId = message.TopicId,
        Role = message.Role,
        Content = message.Content,
        ParentId = message.ParentId,
        ModelId = message.ModelId,
        TokensUsed = message.TokensUsed,
        LatencyMs = message.LatencyMs,
        ThinkingContent = message.ThinkingContent,
        SearchResultsJson = message.SearchResultsJson,
        KnowledgeResultsJson = message.KnowledgeResultsJson,
        MemoryResultsJson = message.MemoryResultsJson,
        CreatedAt = message.CreatedAt
    };

    public async Task<ApiResponse<List<ChatMessageSearchResultDto>>> SearchAsync(string keyword, Guid? topicId = null, Guid? groupId = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(keyword))
            return ApiResponse<List<ChatMessageSearchResultDto>>.Ok([]);

        var lowerKeyword = keyword.ToLowerInvariant();

        // 关键字过滤下推到数据库，避免全表加载后在内存过滤
        IReadOnlyList<ChatMessage> messages;
        if (topicId.HasValue)
        {
            messages = await _unitOfWork.ChatMessages.FindAsync(
                m => m.TopicId == topicId.Value && m.Content.ToLower().Contains(lowerKeyword), cancellationToken);
        }
        else if (groupId.HasValue)
        {
            var groupTopicIds = (await _unitOfWork.ChatTopics.FindAsync(
                t => t.GroupId == groupId.Value, cancellationToken)).Select(t => t.Id).ToList();

            if (groupTopicIds.Count == 0)
                return ApiResponse<List<ChatMessageSearchResultDto>>.Ok([]);

            messages = await _unitOfWork.ChatMessages.FindAsync(
                m => groupTopicIds.Contains(m.TopicId) && m.Content.ToLower().Contains(lowerKeyword), cancellationToken);
        }
        else
        {
            messages = await _unitOfWork.ChatMessages.FindAsync(
                m => m.Content.ToLower().Contains(lowerKeyword), cancellationToken);
        }

        var hits = messages.OrderByDescending(m => m.CreatedAt).Take(50).ToList();

        // 只为命中的消息加载所属话题标题
        var hitTopicIds = hits.Select(m => m.TopicId).Distinct().ToList();
        var topicDict = hitTopicIds.Count == 0
            ? []
            : (await _unitOfWork.ChatTopics.FindAsync(t => hitTopicIds.Contains(t.Id), cancellationToken))
                .ToDictionary(t => t.Id, t => t);

        var results = hits
            .Select(m =>
            {
                topicDict.TryGetValue(m.TopicId, out var topic);
                return new ChatMessageSearchResultDto
                {
                    Id = m.Id,
                    TopicId = m.TopicId,
                    TopicTitle = topic?.Title ?? "未知话题",
                    Role = m.Role,
                    Content = m.Content,
                    ContentSnippet = MakeSnippet(m.Content, lowerKeyword),
                    CreatedAt = m.CreatedAt
                };
            })
            .ToList();

        return ApiResponse<List<ChatMessageSearchResultDto>>.Ok(results);
    }

    private static string MakeSnippet(string content, string keyword)
    {
        if (string.IsNullOrWhiteSpace(content)) return string.Empty;
        var idx = content.ToLower().IndexOf(keyword);
        if (idx < 0) return content.Length > 100 ? content[..100] + "..." : content;

        var start = Math.Max(0, idx - 40);
        var end = Math.Min(content.Length, idx + keyword.Length + 60);
        var snippet = content[start..end];
        if (start > 0) snippet = "..." + snippet;
        if (end < content.Length) snippet += "...";
        return snippet;
    }
}
