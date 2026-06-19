using System.Net.Http;
using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/chat-messages")]
public class ChatMessagesController : ControllerBase
{
    private readonly IChatMessageService _chatMessageService;
    private readonly IChatTopicService _chatTopicService;
    private readonly ILLMProviderFactory _llmProviderFactory;

    public ChatMessagesController(
        IChatMessageService chatMessageService,
        IChatTopicService chatTopicService,
        ILLMProviderFactory llmProviderFactory)
    {
        _chatMessageService = chatMessageService;
        _chatTopicService = chatTopicService;
        _llmProviderFactory = llmProviderFactory;
    }

    [HttpGet("topic/{topicId:guid}")]
    public Task<ApiResponse<List<ChatMessageDto>>> GetByTopic(Guid topicId, CancellationToken cancellationToken)
        => _chatMessageService.GetByTopicAsync(topicId, cancellationToken);

    [HttpGet("search")]
    public Task<ApiResponse<List<ChatMessageSearchResultDto>>> Search([FromQuery] string keyword, [FromQuery] Guid? topicId = null, [FromQuery] Guid? groupId = null, CancellationToken cancellationToken = default)
        => _chatMessageService.SearchAsync(keyword, topicId, groupId, cancellationToken);

    [HttpPost("topic/{topicId:guid}")]
    public Task<ApiResponse<ChatMessageDto>> CreateUserMessage(Guid topicId, [FromBody] SendMessageRequest request, CancellationToken cancellationToken)
        => _chatMessageService.CreateUserMessageAsync(topicId, request.Content, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<ChatMessageDto>> Update(Guid id, [FromBody] UpdateChatMessageRequest request, CancellationToken cancellationToken)
        => _chatMessageService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _chatMessageService.DeleteAsync(id, cancellationToken);

    [HttpPost("topic/{topicId:guid}/stream")]
    public async Task Stream(Guid topicId, [FromBody] SendMessageRequest request, CancellationToken cancellationToken = default)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        async Task WriteEventAsync(string data)
        {
            await Response.WriteAsync($"data: {data}\n\n", cancellationToken);
            await Response.Body.FlushAsync(cancellationToken);
        }

        var topicResult = await _chatTopicService.GetByIdAsync(topicId, cancellationToken);
        if (!topicResult.Success || topicResult.Data == null)
        {
            await WriteEventAsync($"[ERROR] {topicResult.Error}");
            return;
        }
        var topic = topicResult.Data;

        var userMessageResult = await _chatMessageService.CreateUserMessageAsync(topicId, request.Content, cancellationToken);
        if (!userMessageResult.Success)
        {
            await WriteEventAsync($"[ERROR] {userMessageResult.Error}");
            return;
        }

        ILLMProvider? provider;
        Guid? modelId = topic.ModelId;
        if (modelId.HasValue)
        {
            provider = await _llmProviderFactory.CreateProviderAsync(modelId.Value, cancellationToken);
        }
        else
        {
            provider = await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
            modelId = null;
        }

        if (provider == null)
        {
            await WriteEventAsync("[ERROR] 未找到可用的对话模型，请先在设置中配置 AI Provider 和 Model");
            return;
        }

        var history = await _chatMessageService.BuildHistoryAsync(topicId, topic.ContextWindowSize, cancellationToken);
        var chatMessages = history.Select(m => new LlmChatMessage
        {
            Role = m.Role,
            Content = m.Content
        }).ToList();

        var options = new ChatOptions
        {
            ModelId = modelId?.ToString() ?? string.Empty,
            SystemPrompt = topic.CustomSystemPrompt,
            Stream = true
        };

        var sb = new StringBuilder();
        try
        {
            await foreach (var delta in provider.ChatStreamAsync(chatMessages, options, cancellationToken))
            {
                sb.Append(delta);
                await WriteEventAsync(delta);
            }
        }
        catch (HttpRequestException ex)
        {
            await WriteEventAsync($"[ERROR] 调用模型失败：{ex.Message}");
            return;
        }

        await _chatMessageService.SaveAssistantMessageAsync(topicId, sb.ToString(), modelId, cancellationToken);
    }
}
