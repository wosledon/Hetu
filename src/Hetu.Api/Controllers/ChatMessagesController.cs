using System.Net.Http;
using System.Text;
using Hetu.Core.Entities;
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
    private readonly ISemanticSearchService _semanticSearchService;
    private readonly IMemoryService _memoryService;
    private readonly IUnitOfWork _unitOfWork;

    public ChatMessagesController(
        IChatMessageService chatMessageService,
        IChatTopicService chatTopicService,
        ILLMProviderFactory llmProviderFactory,
        IWebSearchService webSearchService,
        ISemanticSearchService semanticSearchService,
        IMemoryService memoryService,
        IUnitOfWork unitOfWork)
    {
        _chatMessageService = chatMessageService;
        _chatTopicService = chatTopicService;
        _llmProviderFactory = llmProviderFactory;
        _webSearchService = webSearchService;
        _semanticSearchService = semanticSearchService;
        _memoryService = memoryService;
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

        // 如果话题之前已整理为笔记，标记为需要重新整理
        if (topic.NoteSyncStatus == "synced")
        {
            var topicEntity = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, cancellationToken);
            if (topicEntity != null)
            {
                topicEntity.NoteSyncStatus = NoteSyncStatus.Outdated;
                await _unitOfWork.SaveChangesAsync(cancellationToken);
            }
        }

        ILLMProvider? provider;
        Guid? modelId;
        if (!string.IsNullOrWhiteSpace(request.ModelId) && Guid.TryParse(request.ModelId, out var reqModelId))
        {
            // 前端选择了模型，优先使用
            modelId = reqModelId;
            provider = await _llmProviderFactory.CreateProviderAsync(modelId.Value, cancellationToken);
        }
        else if (topic.ModelId.HasValue)
        {
            modelId = topic.ModelId;
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

        // 从全局设置读取上下文窗口大小
        int? contextWindowSize = null;
        var ctxSetting = await _unitOfWork.AppSettings.GetByKeyAsync("ContextWindowSize", cancellationToken);
        if (!string.IsNullOrWhiteSpace(ctxSetting?.Value) && int.TryParse(ctxSetting.Value, out var ctxVal))
            contextWindowSize = ctxVal;

        var history = await _chatMessageService.BuildHistoryAsync(topicId, contextWindowSize, cancellationToken);
        var chatMessages = history.Select(m => new LlmChatMessage
        {
            Role = m.Role,
            Content = m.Content
        }).ToList();

        // If images are attached, convert the last user message to multimodal format
        if (request.Images != null && request.Images.Count > 0)
        {
            var lastUserIdx = chatMessages.FindLastIndex(m => m.Role == "user");
            if (lastUserIdx >= 0)
            {
                var parts = new List<LlmContentPart>();
                var existingContent = chatMessages[lastUserIdx].Content;
                if (!string.IsNullOrWhiteSpace(existingContent))
                    parts.Add(new LlmContentPart { Type = "text", Text = existingContent });

                foreach (var img in request.Images)
                {
                    if (provider.ProviderType == "anthropic")
                    {
                        // Anthropic: strip data URI prefix, use base64 directly
                        var base64 = img.Data.Contains(',') ? img.Data[(img.Data.IndexOf(',') + 1)..] : img.Data;
                        parts.Add(new LlmContentPart { Type = "image_url", ImageUrl = base64, MediaType = img.MimeType });
                    }
                    else
                    {
                        // OpenAI-compatible: use data URI format
                        var dataUri = img.Data.StartsWith("data:") ? img.Data : $"data:{img.MimeType};base64,{img.Data}";
                        parts.Add(new LlmContentPart { Type = "image_url", ImageUrl = dataUri });
                    }
                }

                chatMessages[lastUserIdx] = new LlmChatMessage
                {
                    Role = "user",
                    Content = existingContent,
                    ContentParts = parts
                };
            }
        }

        var options = new ChatOptions
        {
            ModelId = modelId?.ToString() ?? string.Empty,
            SystemPrompt = topic.CustomSystemPrompt,
            Stream = true
        };

        // Merge preset system prompt (智能体预设)
        if (!string.IsNullOrWhiteSpace(request.PresetSystemPrompt))
        {
            options.SystemPrompt = string.IsNullOrWhiteSpace(options.SystemPrompt)
                ? request.PresetSystemPrompt
                : options.SystemPrompt + "\n\n" + request.PresetSystemPrompt;
        }

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
        if (request.DeepThinking && reasoningMode != "none")
        {
            // 前端传入的推理强度优先
            var effort = !string.IsNullOrWhiteSpace(request.ReasoningEffort) ? request.ReasoningEffort : reasoningEffort;
            if (effort == "off") { /* 用户关闭了推理 */ }
            else if (reasoningMode == "tag")
            {
                // Tag mode: instruct model to use <thinking> tags
                var thinkPrefix = string.IsNullOrEmpty(options.SystemPrompt) ? "" : options.SystemPrompt + "\n\n";
                options.SystemPrompt = thinkPrefix + "请在回答前先进行深度思考，展示你的推理过程。使用 <thinking> 标签包裹你的思考过程，然后给出最终回答。";
            }
            // Native mode: the provider handles reasoning natively (o1/Claude)
            // reasoning_effort is passed to the provider if supported
        }

        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        string? searchResultsJson = null;

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

                // Save search results JSON for persistence
                searchResultsJson = System.Text.Json.JsonSerializer.Serialize(searchResults, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });

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

        // Knowledge base RAG: semantic search and inject results into context
        if (request.KnowledgeBase)
        {
            try
            {
                var kbResult = await _semanticSearchService.SearchAsync(request.Content, 5, cancellationToken);
                if (kbResult.Success && kbResult.Data?.Items?.Count > 0)
                {
                    var kbItems = kbResult.Data.Items;

                    // Send knowledge base results as a structured event
                    var kbEvent = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        type = "knowledge_results",
                        results = kbItems.Select(r => new { r.Title, r.ContentSnippet, r.Id })
                    }, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
                    await Response.WriteAsync($"data: {kbEvent}\n\n", cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);

                    // Inject knowledge base results into context
                    var kbContext = "以下是从知识库中检索到的相关内容，请基于这些信息回答用户的问题：\n\n";
                    for (int i = 0; i < kbItems.Count; i++)
                    {
                        kbContext += $"[{i + 1}] {kbItems[i].Title}\n内容: {kbItems[i].ContentSnippet}\n\n";
                    }
                    chatMessages.Insert(chatMessages.Count - 1, new LlmChatMessage
                    {
                        Role = "user",
                        Content = kbContext
                    });
                }
            }
            catch
            {
                // 知识库搜索失败不阻塞对话
            }
        }

        // Memory RAG: retrieve relevant memories and inject into context
        List<MemoryDto> retrievedMemories = [];
        if (request.Memory)
        {
            try
            {
                retrievedMemories = await _memoryService.RetrieveForContextAsync(request.Content, 5, cancellationToken);
                if (retrievedMemories.Count > 0)
                {
                    // Send memory results as a structured event
                    var memEvent = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        type = "memory_results",
                        results = retrievedMemories.Select(m => new { m.Id, m.Content, m.Category, m.Score })
                    }, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
                    await Response.WriteAsync($"data: {memEvent}\n\n", cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);

                    // Inject memories into context
                    var memContext = "以下是从你的长期记忆中检索到的相关信息，请参考这些个人记忆来回答用户的问题：\n\n";
                    for (int i = 0; i < retrievedMemories.Count; i++)
                    {
                        var category = string.IsNullOrEmpty(retrievedMemories[i].Category) ? "" : $"[{retrievedMemories[i].Category}]";
                        memContext += $"{i + 1}. {category} {retrievedMemories[i].Content}\n";
                    }
                    chatMessages.Insert(chatMessages.Count - 1, new LlmChatMessage
                    {
                        Role = "user",
                        Content = memContext
                    });
                }
            }
            catch
            {
                // 记忆检索失败不阻塞对话
            }
        }

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
                if (type == "thinking") thinkingSb.Append(text);
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

        await _chatMessageService.SaveAssistantMessageAsync(topicId, contentSb.ToString(), modelId, thinkingSb.Length > 0 ? thinkingSb.ToString() : null, searchResultsJson, cancellationToken);

        // 记忆自动提取：当记忆功能开启时，每 N 条用户消息自动提取一次
        if (request.Memory)
        {
            try
            {
                await _memoryService.TryAutoExtractAsync(topicId, cancellationToken);
            }
            catch
            {
                // 自动提取失败不阻塞对话
            }
        }
    }
}
