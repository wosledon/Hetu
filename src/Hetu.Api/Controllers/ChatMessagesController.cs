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
    private readonly IUnitOfWork _unitOfWork;

    public ChatMessagesController(
        IChatMessageService chatMessageService,
        IChatTopicService chatTopicService,
        ILLMProviderFactory llmProviderFactory,
        IWebSearchService webSearchService,
        IUnitOfWork unitOfWork)
    {
        _chatMessageService = chatMessageService;
        _chatTopicService = chatTopicService;
        _llmProviderFactory = llmProviderFactory;
        _webSearchService = webSearchService;
        _unitOfWork = unitOfWork;
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

        // Deep thinking: use model's reasoning mode configuration
        var reasoningMode = "none";
        var reasoningEffort = "medium";
        if (modelId.HasValue)
        {
            var modelEntity = await _unitOfWork.AiModels.GetByIdAsync(modelId.Value, cancellationToken);
            if (modelEntity != null)
            {
                reasoningMode = modelEntity.ReasoningMode ?? "none";
                reasoningEffort = modelEntity.ReasoningEffort ?? "medium";
            }
        }
        else
        {
            // Default model — check default chat model
            var allModels = await _unitOfWork.AiModels.GetAllAsync(cancellationToken);
            var defaultModel = allModels.FirstOrDefault(m => m.IsDefault && m.Purpose == "chat");
            if (defaultModel != null)
            {
                reasoningMode = defaultModel.ReasoningMode ?? "none";
                reasoningEffort = defaultModel.ReasoningEffort ?? "medium";
                modelId = defaultModel.Id;
            }
        }

        // Apply deep thinking based on model's reasoning mode and user toggle
        if (request.DeepThinking && reasoningMode != "none" && reasoningEffort != "off")
        {
            if (reasoningMode == "tag")
            {
                // Tag mode: instruct model to use <thinking> tags
                var thinkPrefix = string.IsNullOrEmpty(options.SystemPrompt) ? "" : options.SystemPrompt + "\n\n";
                options.SystemPrompt = thinkPrefix + "请在回答前先进行深度思考，展示你的推理过程。使用 <thinking> 标签包裹你的思考过程，然后给出最终回答。";
            }
            // Native mode: the provider handles reasoning natively (o1/Claude)
            // reasoning_effort is passed to the provider if supported
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
            // State machine for parsing <thinking>...</thinking> tags in stream
            var rawSb = new StringBuilder();
            var inThinking = false;
            var thinkTagBuffer = "";
            var jsonOptions = new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase };

            async Task EmitChunkAsync(string type, string text)
            {
                var chunk = System.Text.Json.JsonSerializer.Serialize(new { type, text }, jsonOptions);
                await Response.WriteAsync($"data: {chunk}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);
            }

            await foreach (var delta in provider.ChatStreamAsync(chatMessages, options, cancellationToken))
            {
                // Try to parse as structured JSON (from providers that support native thinking)
                bool parsedAsStructured = false;
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(delta);
                    if (doc.RootElement.TryGetProperty("type", out var typeEl))
                    {
                        var typeStr = typeEl.GetString();
                        var text = doc.RootElement.TryGetProperty("text", out var textEl) ? textEl.GetString() ?? "" : "";
                        await EmitChunkAsync(typeStr ?? "content", text);
                        if (typeStr == "content") contentSb.Append(text);
                        parsedAsStructured = true;
                    }
                }
                catch { /* not JSON, proceed with tag parsing */ }

                if (parsedAsStructured) continue;

                // Raw text from provider — parse <thinking> tags
                rawSb.Append(delta);
                var raw = delta;

                while (raw.Length > 0)
                {
                    if (!inThinking)
                    {
                        // Look for opening <thinking> tag
                        var openIdx = raw.IndexOf("<thinking>", StringComparison.OrdinalIgnoreCase);
                        if (openIdx >= 0)
                        {
                            // Emit content before the tag
                            if (openIdx > 0)
                            {
                                var before = raw[..openIdx];
                                await EmitChunkAsync("content", before);
                                contentSb.Append(before);
                            }
                            inThinking = true;
                            raw = raw[(openIdx + "<thinking>".Length)..];
                            // Emit a thinking start marker
                            await EmitChunkAsync("thinking", "");
                        }
                        else
                        {
                            // No tag found — check if partial tag at end
                            var partialTag = false;
                            for (int k = 1; k < raw.Length && k <= "<thinking>".Length; k++)
                            {
                                if ("<thinking>".StartsWith(raw[^k..], StringComparison.OrdinalIgnoreCase))
                                {
                                    // Buffer partial tag
                                    thinkTagBuffer = raw[^k..];
                                    if (k < raw.Length)
                                    {
                                        var before = raw[..^k];
                                        await EmitChunkAsync("content", before);
                                        contentSb.Append(before);
                                    }
                                    partialTag = true;
                                    break;
                                }
                            }
                            if (!partialTag)
                            {
                                await EmitChunkAsync("content", raw);
                                contentSb.Append(raw);
                            }
                            raw = "";
                        }
                    }
                    else
                    {
                        // Inside thinking — look for closing </thinking> tag
                        var closeIdx = raw.IndexOf("</thinking>", StringComparison.OrdinalIgnoreCase);
                        if (closeIdx >= 0)
                        {
                            var thinkingText = raw[..closeIdx];
                            if (!string.IsNullOrEmpty(thinkingText))
                                await EmitChunkAsync("thinking", thinkingText);
                            inThinking = false;
                            raw = raw[(closeIdx + "</thinking>".Length)..];
                        }
                        else
                        {
                            // Check partial closing tag at end
                            var partialTag = false;
                            for (int k = 1; k < raw.Length && k <= "</thinking>".Length; k++)
                            {
                                if ("</thinking>".StartsWith(raw[^k..], StringComparison.OrdinalIgnoreCase))
                                {
                                    if (k < raw.Length)
                                        await EmitChunkAsync("thinking", raw[..^k]);
                                    thinkTagBuffer = raw[^k..];
                                    partialTag = true;
                                    break;
                                }
                            }
                            if (!partialTag)
                            {
                                await EmitChunkAsync("thinking", raw);
                            }
                            raw = "";
                        }
                    }
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
