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
    private readonly IWebSearchService _webSearchService;

    public ChatMessagesController(
        IChatMessageService chatMessageService,
        IChatTopicService chatTopicService,
        ILLMProviderFactory llmProviderFactory,
        IWebSearchService webSearchService)
    {
        _chatMessageService = chatMessageService;
        _chatTopicService = chatTopicService;
        _llmProviderFactory = llmProviderFactory;
        _webSearchService = webSearchService;
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

        // Deep thinking: instruct the model to think step by step
        if (request.DeepThinking)
        {
            var thinkPrefix = string.IsNullOrEmpty(options.SystemPrompt) ? "" : options.SystemPrompt + "\n\n";
            options.SystemPrompt = thinkPrefix + "请在回答前先进行深度思考，展示你的推理过程。使用 <thinking> 标签包裹你的思考过程，然后给出最终回答。";
        }

        // Web search: search the web and inject results into context
        if (request.WebSearch)
        {
            var searchResults = await _webSearchService.SearchAsync(request.Content, 5, cancellationToken);
            if (searchResults.Count > 0)
            {
                // Send search results as a structured event
                var searchEvent = System.Text.Json.JsonSerializer.Serialize(new { type = "search_results", results = searchResults }, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
                await Response.WriteAsync($"data: {searchEvent}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);

                // Inject search results into context
                var searchContext = "以下是网络搜索的结果，请基于这些信息回答用户的问题，并在回答中引用来源：\n\n";
                for (int i = 0; i < searchResults.Count; i++)
                {
                    searchContext += $"[{i + 1}] {searchResults[i].Title}\n来源: {searchResults[i].Url}\n摘要: {searchResults[i].Snippet}\n\n";
                }
                chatMessages.Insert(chatMessages.Count - 1, new LlmChatMessage
                {
                    Role = "user",
                    Content = searchContext
                });
            }
        }

        var contentSb = new StringBuilder();
        try
        {
            await foreach (var delta in provider.ChatStreamAsync(chatMessages, options, cancellationToken))
            {
                await Response.WriteAsync($"data: {delta}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);

                // Extract content text for persistence (skip thinking chunks)
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(delta);
                    if (doc.RootElement.TryGetProperty("type", out var type) && type.GetString() == "content")
                    {
                        if (doc.RootElement.TryGetProperty("text", out var text))
                            contentSb.Append(text.GetString());
                    }
                }
                catch
                {
                    // If not valid JSON, treat as plain text (backward compat)
                    contentSb.Append(delta);
                }
            }
        }
        catch (HttpRequestException ex)
        {
            await WriteEventAsync($"[ERROR] 调用模型失败：{ex.Message}");
            return;
        }

        await _chatMessageService.SaveAssistantMessageAsync(topicId, contentSb.ToString(), modelId, cancellationToken);
    }
}
