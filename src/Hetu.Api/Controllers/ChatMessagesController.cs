using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Api.Streaming;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;
using Serilog;

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
    private readonly ILocalSkillService _localSkillService;
    private readonly ToolRegistry _toolRegistry;
    private readonly PromptComposer _promptComposer;
    private readonly ToolExecutionService _toolExecution;

    public ChatMessagesController(
        IChatMessageService chatMessageService,
        IChatTopicService chatTopicService,
        ILLMProviderFactory llmProviderFactory,
        IWebSearchService webSearchService,
        ISemanticSearchService semanticSearchService,
        IMemoryService memoryService,
        IUnitOfWork unitOfWork,
        ILocalSkillService localSkillService,
        ToolRegistry toolRegistry,
        PromptComposer promptComposer,
        ToolExecutionService toolExecution)
    {
        _chatMessageService = chatMessageService;
        _chatTopicService = chatTopicService;
        _llmProviderFactory = llmProviderFactory;
        _webSearchService = webSearchService;
        _semanticSearchService = semanticSearchService;
        _memoryService = memoryService;
        _unitOfWork = unitOfWork;
        _localSkillService = localSkillService;
        _toolRegistry = toolRegistry;
        _promptComposer = promptComposer;
        _toolExecution = toolExecution;
    }

    [HttpGet("topic/{topicId:guid}")]
    public Task<ApiResponse<List<ChatMessageDto>>> GetByTopic(Guid topicId, CancellationToken ct)
        => _chatMessageService.GetByTopicAsync(topicId, ct);

    [HttpGet("search")]
    public Task<ApiResponse<List<ChatMessageSearchResultDto>>> Search(
        [FromQuery] string keyword, [FromQuery] Guid? topicId = null,
        [FromQuery] Guid? groupId = null, CancellationToken ct = default)
        => _chatMessageService.SearchAsync(keyword, topicId, groupId, ct);

    [HttpPost("topic/{topicId:guid}")]
    public Task<ApiResponse<ChatMessageDto>> CreateUserMessage(
        Guid topicId, [FromBody] SendMessageRequest request, CancellationToken ct)
        => _chatMessageService.CreateUserMessageAsync(topicId, request.Content, ct);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<ChatMessageDto>> Update(
        Guid id, [FromBody] UpdateChatMessageRequest request, CancellationToken ct)
        => _chatMessageService.UpdateAsync(id, request, ct);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken ct)
        => _chatMessageService.DeleteAsync(id, ct);

    [HttpPost("answer")]
    public ApiResponse SubmitAnswer([FromBody] AnswerRequest request)
    {
        if (_toolExecution.TrySetAnswer(request.SessionId, request.ToolCallId, request.Answer))
            return ApiResponse.Ok();
        return ApiResponse.Fail("未找到对应的提问请求");
    }

    [HttpPost("approve")]
    public ApiResponse SubmitApproval([FromBody] ApprovalRequest request)
    {
        if (_toolExecution.TrySetApproval(request.SessionId, request.ToolCallId, request.Approve))
            return ApiResponse.Ok();
        return ApiResponse.Fail("未找到对应的审批请求");
    }

    [HttpPost("topic/{topicId:guid}/stream")]
    public async Task Stream(Guid topicId, [FromBody] SendMessageRequest request, CancellationToken ct = default)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        var writer = new SseStreamWriter(Response, ct);

        Log.Debug("[Stream] content={Content}, enableTools={EnableTools}",
            request.Content?.Length > 50 ? request.Content[..50] + "..." : request.Content, request.EnableTools);

        var topicResult = await _chatTopicService.GetByIdAsync(topicId, ct);
        if (!topicResult.Success || topicResult.Data == null) { await writer.WriteErrorAsync(topicResult.Error ?? "话题不存在"); return; }
        var topic = topicResult.Data;

        var userMsgResult = await _chatMessageService.CreateUserMessageAsync(topicId, request.Content ?? "", ct);
        if (!userMsgResult.Success) { await writer.WriteErrorAsync(userMsgResult.Error ?? "创建消息失败"); return; }

        await MarkTopicOutdatedIfNeededAsync(topic, topicId, ct);

        var (provider, modelId) = await ResolveProviderAsync(request, topic, ct);
        if (provider == null) { await writer.WriteErrorAsync("未找到可用的对话模型"); return; }

        var chatMessages = await BuildChatHistoryAsync(topicId, request, provider, ct);
        var options = await BuildChatOptionsAsync(request, topic, modelId, ct);
        var (searchJson, kbJson, memJson) = await InjectRagAsync(request, chatMessages, writer, ct);

        var profile = Hetu.Core.Profiles.BuiltinProfiles.Knowledge;
        var (useToolCalling, approvalOverrides) = ConfigureToolCalling(request, profile, options);

        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        var sessionTodos = new List<SessionTodo>();
        const int maxIterations = 15;
        var maxIter = profile.MaxAgentIterations > 0 ? profile.MaxAgentIterations : maxIterations;

        for (int iter = 0; iter < maxIter; iter++)
        {
            await writer.WriteDebugAsync($"Iteration {iter + 1}, tools={options.Tools?.Count ?? 0}");

            var (iterContent, iterThinking, pendingToolCalls) = await ChatStreamProcessor.ProcessStreamAsync(
                provider, chatMessages, options, writer, ct);

            if (pendingToolCalls == null || pendingToolCalls.Count == 0 || !useToolCalling)
            {
                contentSb.Append(iterContent);
                thinkingSb.Append(iterThinking);
                break;
            }

            contentSb.Append(iterContent);
            thinkingSb.Append(iterThinking);

            chatMessages.Add(new LlmChatMessage
            {
                Role = "assistant",
                Content = iterContent.ToString(),
                ToolCalls = pendingToolCalls
            });

            var toolResults = await _toolExecution.ExecuteToolCallsAsync(
                topicId.ToString(),
                pendingToolCalls, approvalOverrides, sessionTodos,
                data => writer.WriteEventAsync(data),
                payload => writer.WriteJsonAsync(payload),
                ct);

            foreach (var (toolCallId, content) in toolResults)
            {
                chatMessages.Add(new LlmChatMessage { Role = "tool", ToolCallId = toolCallId, Content = content });
            }
        }

        var finalContent = contentSb.ToString().Trim();
        if (!string.IsNullOrEmpty(finalContent))
        {
            await _chatMessageService.SaveAssistantMessageAsync(topicId, contentSb.ToString(), modelId,
                thinkingSb.Length > 0 ? thinkingSb.ToString() : null,
                searchJson, kbJson, memJson, ct);
        }

        if (request.Memory)
        {
            try { await _memoryService.TryAutoExtractAsync(topicId, ct); } catch { }
        }
    }

    private async Task MarkTopicOutdatedIfNeededAsync(ChatTopicDto topic, Guid topicId, CancellationToken ct)
    {
        if (topic.NoteSyncStatus != "synced") return;
        var entity = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, ct);
        if (entity != null)
        {
            entity.NoteSyncStatus = NoteSyncStatus.Outdated;
            await _unitOfWork.SaveChangesAsync(ct);
        }
    }

    private async Task<(ILLMProvider? provider, Guid? modelId)> ResolveProviderAsync(
        SendMessageRequest request, ChatTopicDto topic, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(request.ModelId) && Guid.TryParse(request.ModelId, out var reqId))
            return (await _llmProviderFactory.CreateProviderAsync(reqId, ct), reqId);
        if (topic.ModelId.HasValue)
            return (await _llmProviderFactory.CreateProviderAsync(topic.ModelId.Value, ct), topic.ModelId);
        return (await _llmProviderFactory.CreateChatProviderAsync(ct), null);
    }

    private async Task<List<LlmChatMessage>> BuildChatHistoryAsync(
        Guid topicId, SendMessageRequest request, ILLMProvider provider, CancellationToken ct)
    {
        int? ctxSize = null;
        var ctxSetting = await _unitOfWork.AppSettings.GetByKeyAsync("ContextWindowSize", ct);
        if (!string.IsNullOrWhiteSpace(ctxSetting?.Value) && int.TryParse(ctxSetting.Value, out var v))
            ctxSize = v;

        var history = await _chatMessageService.BuildHistoryAsync(topicId, ctxSize, ct);
        var messages = history.Select(m => new LlmChatMessage { Role = m.Role, Content = m.Content }).ToList();

        if (request.Images is { Count: > 0 })
        {
            var lastUserIdx = messages.FindLastIndex(m => m.Role == "user");
            if (lastUserIdx >= 0)
            {
                var parts = new List<LlmContentPart>();
                var existing = messages[lastUserIdx].Content;
                if (!string.IsNullOrWhiteSpace(existing))
                    parts.Add(new LlmContentPart { Type = "text", Text = existing });
                foreach (var img in request.Images)
                {
                    if (provider.ProviderType == "anthropic")
                    {
                        var b64 = img.Data.Contains(',') ? img.Data[(img.Data.IndexOf(',') + 1)..] : img.Data;
                        parts.Add(new LlmContentPart { Type = "image_url", ImageUrl = b64, MediaType = img.MimeType });
                    }
                    else
                    {
                        var uri = img.Data.StartsWith("data:") ? img.Data : $"data:{img.MimeType};base64,{img.Data}";
                        parts.Add(new LlmContentPart { Type = "image_url", ImageUrl = uri });
                    }
                }
                messages[lastUserIdx] = new LlmChatMessage { Role = "user", Content = existing, ContentParts = parts };
            }
        }
        return messages;
    }

    private async Task<ChatOptions> BuildChatOptionsAsync(
        SendMessageRequest request, ChatTopicDto topic, Guid? modelId, CancellationToken ct)
    {
        var options = new ChatOptions { ModelId = modelId?.ToString() ?? "", Stream = true };
        var profile = Hetu.Core.Profiles.BuiltinProfiles.Knowledge;

        string? skillPrompt = null;
        if (!string.IsNullOrWhiteSpace(request.SkillName))
            skillPrompt = await ResolveSkillPromptAsync(request.SkillName, ct);

        options.SystemPrompt = _promptComposer.Compose(new PromptComposeContext
        {
            Profile = profile,
            AgentPresetPrompt = request.PresetSystemPrompt,
            SkillPrompt = skillPrompt,
            TopicCustomPrompt = topic.CustomSystemPrompt,
            EnabledTools = request.EnableTools ? request.EnabledTools : null,
            Now = DateTimeOffset.Now,
            TopicTitle = topic.Title,
            Locale = "zh-CN",
        });

        await ApplyDeepThinkingAsync(request, options, modelId);
        return options;
    }

    private async Task<string?> ResolveSkillPromptAsync(string skillName, CancellationToken ct)
    {
        var skill = (await _unitOfWork.Skills.FindAsync(s => s.Name == skillName && s.IsEnabled, ct)).FirstOrDefault();
        string? config = skill?.Config;

        if (config == null)
        {
            var localResult = await _localSkillService.ScanAllAsync(ct);
            var local = (localResult.Data ?? []).FirstOrDefault(s => s.IsEnabled && s.Name.Contains(skillName, StringComparison.OrdinalIgnoreCase));
            config = local?.Config;
        }

        if (config != null)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(config);
                if (doc.RootElement.TryGetProperty("systemPrompt", out var sp))
                    return sp.GetString();
            }
            catch { }
        }
        return null;
    }

    private async Task ApplyDeepThinkingAsync(SendMessageRequest request, ChatOptions options, Guid? modelId)
    {
        if (!request.DeepThinking) return;

        string reasoningMode = "none";
        if (modelId.HasValue)
        {
            var model = await _unitOfWork.AiModels.GetByIdAsync(modelId.Value);
            if (model != null) reasoningMode = model.ReasoningMode ?? "none";
        }
        if (reasoningMode == "none") return;

        if (reasoningMode == "tag")
        {
            options.SystemPrompt = (options.SystemPrompt ?? "") + "\n\n请在回答前先进行深度思考，展示你的推理过程。使用 <thinking> 标签包裹你的思考过程，然后给出最终回答。";
        }
        else if (reasoningMode == "native")
        {
            var effort = !string.IsNullOrWhiteSpace(request.ReasoningEffort) ? request.ReasoningEffort : "medium";
            options.ReasoningEffort = effort;
        }
    }

    private async Task<(string? search, string? knowledge, string? memory)> InjectRagAsync(
        SendMessageRequest request, List<LlmChatMessage> messages, SseStreamWriter writer, CancellationToken ct)
    {
        string? searchJson = null, kbJson = null, memJson = null;

        if (request.WebSearch)
        {
            var results = await _webSearchService.SearchAsync(request.Content, 5, ct);
            if (results.Count > 0)
            {
                await writer.WriteJsonAsync(new { type = "search_results", results });
                searchJson = System.Text.Json.JsonSerializer.Serialize(results);
                messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildSearchContext(results) });
            }
        }

        if (request.KnowledgeBase)
        {
            try
            {
                var kbResult = await _semanticSearchService.SearchAsync(request.Content, 5, ct);
                if (kbResult.Success && kbResult.Data?.Items?.Count > 0)
                {
                    var items = kbResult.Data.Items;
                    await writer.WriteJsonAsync(new { type = "knowledge_results", results = items.Select(r => new { r.Title, r.ContentSnippet, r.Id }) });
                    kbJson = System.Text.Json.JsonSerializer.Serialize(items.Select(r => new { r.Title, r.ContentSnippet, r.Id }));
                    messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildKnowledgeContext(items) });
                }
            }
            catch { }
        }

        if (request.Memory)
        {
            try
            {
                var memories = await _memoryService.RetrieveForContextAsync(request.Content, 5, ct);
                if (memories.Count > 0)
                {
                    await writer.WriteJsonAsync(new { type = "memory_results", results = memories.Select(m => new { m.Id, m.Content, m.Category, m.Score }) });
                    memJson = System.Text.Json.JsonSerializer.Serialize(memories.Select(m => new { m.Id, m.Content, m.Category, m.Score }));
                    messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildMemoryContext(memories) });
                }
            }
            catch { }
        }

        return (searchJson, kbJson, memJson);
    }

    private (bool useToolCalling, Dictionary<string, ToolApprovalMode> overrides) ConfigureToolCalling(
        SendMessageRequest request, Hetu.Core.Profiles.RuntimeProfile profile, ChatOptions options)
    {
        var overrides = new Dictionary<string, ToolApprovalMode>();
        if (!request.EnableTools) return (false, overrides);

        var effectiveNames = _promptComposer.ResolveEffectiveTools(profile, request.EnabledTools);
        var definitions = _toolRegistry.ToToolDefinitions(effectiveNames);
        options.Tools = definitions;
        options.ToolChoice = "auto";

        if (request.ToolApprovalOverrides != null)
        {
            foreach (var kv in request.ToolApprovalOverrides)
                if (Enum.TryParse<ToolApprovalMode>(kv.Value, true, out var mode))
                    overrides[kv.Key] = mode;
        }
        return (true, overrides);
    }

    private static string BuildSearchContext(List<WebSearchResultDto> results)
    {
        var sb = new StringBuilder("以下是网络搜索的结果，请基于这些信息回答用户的问题：\n\n");
        for (int i = 0; i < results.Count; i++)
            sb.AppendLine($"[{i + 1}] {results[i].Title}\n来源: {results[i].Url}\n摘要: {results[i].Snippet}\n");
        return sb.ToString();
    }

    private static string BuildKnowledgeContext(IReadOnlyList<NoteSearchResultDto> items)
    {
        var sb = new StringBuilder("以下是从知识库中检索到的相关内容：\n\n");
        for (int i = 0; i < items.Count; i++)
            sb.AppendLine($"[{i + 1}] {items[i].Title}\n内容: {items[i].ContentSnippet ?? ""}\n");
        return sb.ToString();
    }

    private static string BuildMemoryContext(List<MemoryDto> memories)
    {
        var sb = new StringBuilder("以下是从你的长期记忆中检索到的相关信息：\n\n");
        for (int i = 0; i < memories.Count; i++)
            sb.AppendLine($"{i + 1}. {(string.IsNullOrEmpty(memories[i].Category) ? "" : $"[{memories[i].Category}] ")}{memories[i].Content}");
        return sb.ToString();
    }
}