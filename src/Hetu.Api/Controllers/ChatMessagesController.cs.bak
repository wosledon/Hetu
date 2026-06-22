using System.Collections.Concurrent;
using System.Net.Http;
using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;
using Serilog;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/chat-messages")]
public class ChatMessagesController : ControllerBase
{
    // Pending ask_question requests: key = toolCallId, value = TCS that Agent Loop is waiting on
    private static readonly ConcurrentDictionary<string, TaskCompletionSource<string>> _pendingQuestions = new();
    // Pending approval requests: key = toolCallId, value = TCS that Agent Loop is waiting on
    private static readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> _pendingApprovals = new();
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
        PromptComposer promptComposer)
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

    [HttpPost("answer")]
    public async Task<ApiResponse> SubmitAnswer([FromBody] AnswerRequest request, CancellationToken cancellationToken)
    {
        if (_pendingQuestions.TryRemove(request.ToolCallId, out var tcs))
        {
            tcs.TrySetResult(request.Answer);
            return ApiResponse.Ok();
        }
        return ApiResponse.Fail("未找到对应的提问请求");
    }

    [HttpPost("approve")]
    public async Task<ApiResponse> SubmitApproval([FromBody] ApprovalRequest request, CancellationToken cancellationToken)
    {
        if (_pendingApprovals.TryRemove(request.ToolCallId, out var tcs))
        {
            tcs.TrySetResult(request.Approve);
            return ApiResponse.Ok();
        }
        return ApiResponse.Fail("未找到对应的审批请求");
    }

    [HttpPost("topic/{topicId:guid}/stream")]
    public async Task Stream(Guid topicId, [FromBody] SendMessageRequest request, CancellationToken cancellationToken = default)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        Log.Debug("[Stream] Request received: content={Content}, enableTools={EnableTools}, toolCount={ToolCount}, modelId={ModelId}",
            request.Content?.Length > 50 ? request.Content[..50] + "..." : request.Content,
            request.EnableTools, request.EnabledTools?.Count ?? 0, request.ModelId);

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
            Stream = true
        };

        // === System prompt 组装 ===
        // 分层结构：Profile 身份 → Agent 预设 → Skill 指令 → 工具约束 → 上下文 → Topic 自定义
        // 当前 Controller 服务于 Chat 场景，绑定 Knowledge profile；
        // 桌面 Agent / CoWork 等场景将由独立 Controller 提供，并绑定各自 profile。
        var profile = Hetu.Core.Profiles.BuiltinProfiles.Knowledge;

        // 如果用户通过 /skill 命令激活了技能，读取其 system prompt 注入到 system prompt 中
        string? skillPrompt = null;
        if (!string.IsNullOrWhiteSpace(request.SkillName))
        {
            Log.Information("[Skill] 收到 SkillName 请求: {SkillName}", request.SkillName);

            // 先查 DB 中的 skill
            var skill = (await _unitOfWork.Skills.FindAsync(
                s => s.Name == request.SkillName && s.IsEnabled, cancellationToken)).FirstOrDefault();

            string? skillConfig = null;
            if (skill?.Config != null)
            {
                Log.Information("[Skill] DB 中找到 skill: {Name}, Config: {Config}", skill.Name, skill.Config);
                skillConfig = skill.Config;
            }
            else
            {
                Log.Information("[Skill] DB 未找到，回退扫描本地 skill");
                // DB 未找到，回退到本地 skill（使用 Contains 模糊匹配，兼容 YAML 引号等差异）
                var localResult = await _localSkillService.ScanAllAsync(cancellationToken);
                var localSkills = localResult.Data ?? [];
                Log.Information("[Skill] 本地扫描到 {Count} 个 skill: {Names}",
                    localSkills.Count, localSkills.Select(s => s.Name));

                var localSkill = localSkills.FirstOrDefault(
                    s => s.IsEnabled && s.Name.Contains(request.SkillName, StringComparison.OrdinalIgnoreCase));
                if (localSkill != null)
                {
                    Log.Information("[Skill] 本地匹配到 skill: {Name}, Config: {Config}", localSkill.Name, localSkill.Config);
                    skillConfig = localSkill.Config;
                }
                else
                {
                    Log.Warning("[Skill] 本地也未找到匹配的 skill，SkillName: {SkillName}", request.SkillName);
                }
            }

            if (!string.IsNullOrWhiteSpace(skillConfig))
            {
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(skillConfig);
                    if (doc.RootElement.TryGetProperty("systemPrompt", out var sp))
                    {
                        skillPrompt = sp.GetString();
                        Log.Information("[Skill] 提取到 systemPrompt ({Len} 字符): {Prompt}",
                            skillPrompt?.Length ?? 0, skillPrompt?.Length > 200 ? skillPrompt![..200] + "..." : skillPrompt);
                    }
                    else
                    {
                        Log.Warning("[Skill] Config 中未找到 systemPrompt 字段: {Config}", skillConfig);
                    }
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "[Skill] Config JSON 解析失败: {Config}", skillConfig);
                }
            }
        }
        else
        {
            Log.Debug("[Skill] 未收到 SkillName，跳过 skill 注入");
        }

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

        Log.Information("[Skill] systemPrompt 组装完成, SkillPrompt={SkillPrompt}, 总长度={Len}",
            skillPrompt != null ? (skillPrompt.Length > 100 ? skillPrompt[..100] + "..." : skillPrompt) : "null",
            options.SystemPrompt.Length);

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
            else if (reasoningMode == "native")
            {
                // Native mode: pass reasoning_effort to provider
                options.ReasoningEffort = effort;
            }
        }

        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        string? searchResultsJson = null;
        string? knowledgeResultsJson = null;
        string? memoryResultsJson = null;

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

                    // Save knowledge results JSON for persistence
                    knowledgeResultsJson = System.Text.Json.JsonSerializer.Serialize(
                        kbItems.Select(r => new { r.Title, r.ContentSnippet, r.Id }),
                        new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });

                    // Inject knowledge base results into context
                    var kbContext = "以下是从知识库中检索到的相关内容，请基于这些信息回答用户的问题。**注意：不要在回答中使用 [[...]] 或任何 wiki-link 格式引用来源，直接给出自然的回答即可。**\n\n";
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

                    // Save memory results JSON for persistence
                    memoryResultsJson = System.Text.Json.JsonSerializer.Serialize(
                        retrievedMemories.Select(m => new { m.Id, m.Content, m.Category, m.Score }),
                        new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });

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

        // === Agent Loop Configuration ===
        var useToolCalling = request.EnableTools;
        List<LlmToolDefinition>? toolDefinitions = null;
        Dictionary<string, ToolApprovalMode> approvalOverrides = new();

        if (useToolCalling)
        {
            // Profile 强制过滤：前端请求 ∩ profile 允许 ∩ 已注册的工具
            var effectiveToolNames = _promptComposer.ResolveEffectiveTools(profile, request.EnabledTools);
            toolDefinitions = _toolRegistry.ToToolDefinitions(effectiveToolNames);
            if (request.ToolApprovalOverrides != null)
            {
                foreach (var kv in request.ToolApprovalOverrides)
                {
                    if (Enum.TryParse<ToolApprovalMode>(kv.Value, true, out var mode))
                        approvalOverrides[kv.Key] = mode;
                }
            }
            options.Tools = toolDefinitions;
            options.ToolChoice = "auto";
            Log.Debug("[AgentLoop] Profile={Profile}, Tools={ToolCount}, Names={ToolNames}",
                profile.Id,
                toolDefinitions.Count,
                string.Join(", ", toolDefinitions.Select(t => t.Name)));
        }
        else
        {
            Log.Debug("[AgentLoop] Tool calling disabled");
        }

        const int maxAgentIterations = 15;
        var profileMaxIterations = profile.MaxAgentIterations > 0 ? profile.MaxAgentIterations : maxAgentIterations;
        var agentIteration = 0;

        // Per-stream todo list so the todo tool can resolve ids and report state back to the LLM
        var sessionTodos = new List<SessionTodo>();

        // Agent Loop: iterate LLM calls when tool_calls are returned
        while (agentIteration < profileMaxIterations)
        {
            agentIteration++;
            var iterLog = $"[AgentLoop] Iteration {agentIteration}, useToolCalling={useToolCalling}, tools={toolDefinitions?.Count ?? 0}";
            await WriteEventAsync($"{{\"type\":\"debug\",\"text\":{System.Text.Json.JsonSerializer.Serialize(iterLog)}}}");

            // Per-iteration state (don't clear contentSb/thinkingSb — accumulate across iterations)
            var iterationContentSb = new StringBuilder();
            var iterationThinkingSb = new StringBuilder();

            List<LlmToolCall>? pendingToolCalls = null;
            var jsonOptions = new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase };

            try
            {
                // State machine for parsing <thinking>...</thinking> tags in stream
                var rawSb = new StringBuilder();
                var inThinking = false;
                var thinkTagBuffer = "";

                async Task EmitChunkAsync(string type, string text)
                {
                    var chunk = System.Text.Json.JsonSerializer.Serialize(new { type, text }, jsonOptions);
                    await Response.WriteAsync($"data: {chunk}\n\n", cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);
                    if (type == "thinking") iterationThinkingSb.Append(text);
                    if (type == "content") iterationContentSb.Append(text);
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
                            if (typeStr == "tool_calls")
                            {
                                // Capture tool calls from provider (camelCase from provider)
                                if (doc.RootElement.TryGetProperty("toolCalls", out var tcArray))
                                {
                                    var tcOptions = new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase };
                                    pendingToolCalls = System.Text.Json.JsonSerializer.Deserialize<List<LlmToolCall>>(tcArray.GetRawText(), tcOptions);
                                }
                            }
                            else
                            {
                                await EmitChunkAsync(typeStr ?? "content", text);
                            }
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
                                        }
                                        partialTag = true;
                                        break;
                                    }
                                }
                                if (!partialTag)
                                {
                                    await EmitChunkAsync("content", raw);
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
                Log.Warning("[AgentLoop] Iter {Iter}: HttpRequestException: {Msg}", agentIteration, ex.Message);
                // If this was a tool call iteration that failed, strip tool messages and retry without tools
                if (pendingToolCalls is { Count: > 0 } && agentIteration > 1)
                {
                    Log.Warning("[AgentLoop] Tool call iteration failed, stripping tool messages and saving content");
                    // Remove the tool-related messages we added
                    while (chatMessages.Count > 0 && chatMessages[^1].Role is "tool" or "assistant")
                    {
                        var last = chatMessages[^1];
                        if (last.Role == "tool" || (last.Role == "assistant" && last.ToolCalls is { Count: > 0 }))
                            chatMessages.RemoveAt(chatMessages.Count - 1);
                        else break;
                    }
                    // Merge content from the successful first iteration
                    // (iterationContentSb is from the failed iteration, so don't merge it)
                }
                else
                {
                    contentSb.Append(iterationContentSb);
                    thinkingSb.Append(iterationThinkingSb);
                }
                await WriteEventAsync($"[ERROR] 调用模型失败：{ex.Message}");
                break;
            }
            catch (OperationCanceledException)
            {
                contentSb.Append(iterationContentSb);
                thinkingSb.Append(iterationThinkingSb);
                await WriteEventAsync("[ERROR] 请求超时或被取消");
                break;
            }
            catch (Exception ex)
            {
                contentSb.Append(iterationContentSb);
                thinkingSb.Append(iterationThinkingSb);
                await WriteEventAsync($"[ERROR] Agent Loop 异常：{ex.Message}");
                break;
            }

            // Check for tool calls after stream completes
            var debugTcCount = pendingToolCalls?.Count ?? 0;
            Log.Debug("[AgentLoop] Iter {Iter}: Stream done. pendingToolCalls={TcCount}, iterationContent={Len}chars, useToolCalling={Use}", agentIteration, debugTcCount, iterationContentSb.Length, useToolCalling);
            await WriteEventAsync($"{{\"type\":\"debug\",\"text\":{System.Text.Json.JsonSerializer.Serialize($"[AgentLoop] Stream done. pendingToolCalls={debugTcCount}, iterationContent={iterationContentSb.Length}chars, useToolCalling={useToolCalling}")}}}");

            if (pendingToolCalls == null || pendingToolCalls.Count == 0 || !useToolCalling)
            {
                Log.Debug("[AgentLoop] No tool calls, breaking loop");
                // No tool calls — normal completion, merge and break
                contentSb.Append(iterationContentSb);
                thinkingSb.Append(iterationThinkingSb);
                break;
            }

            // Merge iteration buffers into main buffers
            contentSb.Append(iterationContentSb);
            thinkingSb.Append(iterationThinkingSb);

            // === Execute tool calls ===
            // Add assistant message with tool_calls to history (use iteration content only)
            chatMessages.Add(new LlmChatMessage
            {
                Role = "assistant",
                Content = iterationContentSb.ToString(),
                ToolCalls = pendingToolCalls
            });

            foreach (var toolCall in pendingToolCalls)
            {
                // Emit tool_call event to frontend
                // todo / ask_question 有专门的事件渲染（streamingTodos / streamingQuestions），
                // 因此其 tool_call 和 tool_result 应标记为 hidden，避免在消息流里重复展示原始 JSON
                bool isSilentTool = toolCall.Name is "todo" or "ask_question";
                var tcEvent = System.Text.Json.JsonSerializer.Serialize(new
                {
                    type = "tool_call",
                    id = toolCall.Id,
                    name = toolCall.Name,
                    arguments = toolCall.Arguments,
                    hidden = isSilentTool
                }, jsonOptions);
                await Response.WriteAsync($"data: {tcEvent}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);

                // Check approval mode
                var executor = _toolRegistry.GetExecutor(toolCall.Name);
                var approval = approvalOverrides.GetValueOrDefault(toolCall.Name,
                    approvalOverrides.GetValueOrDefault("*",
                        executor?.DefaultApproval ?? ToolApprovalMode.Auto));

                async Task<(string content, bool isError)> ExecuteToolAsync(
                    LlmToolCall tc, IToolExecutor toolExecutor,
                    List<SessionTodo> todos,
                    System.Text.Json.JsonSerializerOptions jOpts,
                    CancellationToken ct)
                {
                    try
                    {
                        // Special handling for ask_question: emit question event and wait for answer
                        if (tc.Name == "ask_question")
                        {
                            var questionEvent = System.Text.Json.JsonSerializer.Serialize(new
                            {
                                type = "question",
                                toolCallId = tc.Id,
                                data = tc.Arguments
                            }, jOpts);
                            await Response.WriteAsync($"data: {questionEvent}\n\n", ct);
                            await Response.Body.FlushAsync(ct);

                            var tcs = new TaskCompletionSource<string>();
                            _pendingQuestions[tc.Id] = tcs;

                            try
                            {
                                var answer = await tcs.Task.WaitAsync(TimeSpan.FromMinutes(5), ct);
                                return (answer, false);
                            }
                            catch (TimeoutException)
                            {
                                return ("用户未在规定时间内回答，跳过此问题。", false);
                            }
                            finally
                            {
                                _pendingQuestions.TryRemove(tc.Id, out _);
                            }
                        }
                        // Special handling for todo: maintain state and emit structured event
                        else if (tc.Name == "todo")
                        {
                            string todoAction = "list";
                            string todoId = "";
                            string todoTitle = "";
                            string todoDescription = "";
                            string todoStatus = "";

                            try
                            {
                                using var todoDoc = System.Text.Json.JsonDocument.Parse(tc.Arguments);
                                var todoRoot = todoDoc.RootElement;
                                if (todoRoot.TryGetProperty("action", out var actionEl))
                                    todoAction = actionEl.GetString() ?? "list";
                                if (todoRoot.TryGetProperty("id", out var idEl) && idEl.ValueKind == System.Text.Json.JsonValueKind.String)
                                    todoId = idEl.GetString() ?? "";
                                if (todoRoot.TryGetProperty("title", out var titleEl))
                                    todoTitle = titleEl.GetString() ?? "";
                                if (todoRoot.TryGetProperty("description", out var descEl))
                                    todoDescription = descEl.GetString() ?? "";
                                if (todoRoot.TryGetProperty("status", out var statusEl))
                                    todoStatus = statusEl.GetString() ?? "";
                            }
                            catch { }

                            if (todoAction == "create" && !string.IsNullOrEmpty(todoTitle))
                            {
                                if (string.IsNullOrEmpty(todoId))
                                    todoId = $"step-{todos.Count + 1}";
                                if (string.IsNullOrEmpty(todoStatus))
                                    todoStatus = "not-started";
                                if (!todos.Any(t => t.Id == todoId))
                                    todos.Add(new SessionTodo { Id = todoId, Title = todoTitle, Status = todoStatus });
                            }
                            else if (todoAction == "update")
                            {
                                var existing = !string.IsNullOrEmpty(todoId)
                                    ? todos.FirstOrDefault(t => t.Id == todoId)
                                    : null;
                                if (existing == null && !string.IsNullOrEmpty(todoTitle))
                                    existing = todos.FirstOrDefault(t => string.Equals(t.Title, todoTitle, StringComparison.OrdinalIgnoreCase));
                                if (existing == null)
                                    existing = todos.FirstOrDefault(t => t.Status != "completed");
                                if (existing != null && !string.IsNullOrEmpty(todoStatus))
                                {
                                    existing.Status = todoStatus;
                                    todoId = existing.Id;
                                }
                            }
                            else if (todoAction == "complete")
                            {
                                var existing = !string.IsNullOrEmpty(todoId)
                                    ? todos.FirstOrDefault(t => t.Id == todoId)
                                    : null;
                                if (existing == null && !string.IsNullOrEmpty(todoTitle))
                                    existing = todos.FirstOrDefault(t => string.Equals(t.Title, todoTitle, StringComparison.OrdinalIgnoreCase));
                                if (existing == null)
                                    existing = todos.FirstOrDefault(t => t.Status != "completed");
                                if (existing != null)
                                {
                                    existing.Status = "completed";
                                    todoId = existing.Id;
                                    todoStatus = "completed";
                                }
                            }

                            var todoEvent = System.Text.Json.JsonSerializer.Serialize(new
                            {
                                type = "todo",
                                data = new
                                {
                                    action = todoAction,
                                    id = todoId,
                                    title = todoTitle,
                                    description = todoDescription,
                                    status = todoStatus,
                                    todos = todos.Select(t => new { t.Id, t.Title, t.Status }).ToList()
                                }
                            }, jOpts);
                            await Response.WriteAsync($"data: {todoEvent}\n\n", ct);
                            await Response.Body.FlushAsync(ct);

                            if (todos.Count == 0)
                                return ("当前工作计划为空。使用 action=create 创建步骤。", false);

                            var todoSb = new StringBuilder();
                            todoSb.AppendLine($"当前工作计划（共 {todos.Count} 个步骤）：");
                            foreach (var t in todos)
                            {
                                var statusMark = t.Status switch
                                {
                                    "completed" => "[已完成]",
                                    "in-progress" => "[进行中]",
                                    _ => "[未开始]"
                                };
                                todoSb.AppendLine($"  - id={t.Id} {statusMark} {t.Title}");
                            }
                            var nextPending = todos.FirstOrDefault(t => t.Status != "completed");
                            if (nextPending != null)
                            {
                                todoSb.AppendLine();
                                todoSb.AppendLine($"下一步：开始执行 \"{nextPending.Title}\"（id={nextPending.Id}）。先调用 todo(action=update, id={nextPending.Id}, status=in-progress)，做完后调用 todo(action=complete, id={nextPending.Id})。");
                            }
                            else
                            {
                                todoSb.AppendLine();
                                todoSb.AppendLine("所有步骤已完成。");
                            }
                            return (todoSb.ToString(), false);
                        }
                        else
                        {
                            var result = await toolExecutor.ExecuteAsync(tc.Arguments, ct);
                            return (result.Content, result.IsError);
                        }
                    }
                    catch (Exception ex)
                    {
                        return ($"工具执行失败: {ex.Message}", true);
                    }
                }

                string toolResultContent = string.Empty;
                bool toolResultIsError = false;

                if (approval == ToolApprovalMode.Ask && toolCall.Name != "ask_question" && toolCall.Name != "todo")
                {
                    // For Ask mode: emit approval request and wait for user confirmation
                    var approvalReqEvent = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        type = "approval_request",
                        id = toolCall.Id,
                        name = toolCall.Name,
                        arguments = toolCall.Arguments
                    }, jsonOptions);
                    await Response.WriteAsync($"data: {approvalReqEvent}\n\n", cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);

                    // Wait for user approval
                    var approvalTcs = new TaskCompletionSource<bool>();
                    _pendingApprovals[toolCall.Id] = approvalTcs;

                    bool approved;
                    try
                    {
                        approved = await approvalTcs.Task.WaitAsync(TimeSpan.FromMinutes(5), cancellationToken);
                    }
                    catch (TimeoutException)
                    {
                        toolResultContent = $"用户未在规定时间内确认工具 \"{toolCall.Name}\" 的执行，已跳过。";
                        toolResultIsError = true;
                        approved = false;
                    }
                    finally
                    {
                        _pendingApprovals.TryRemove(toolCall.Id, out _);
                    }

                    if (approved && executor != null)
                    {
                        (toolResultContent, toolResultIsError) = await ExecuteToolAsync(toolCall, executor, sessionTodos, jsonOptions, cancellationToken);
                    }
                    else if (approved)
                    {
                        toolResultContent = $"未找到工具: {toolCall.Name}";
                        toolResultIsError = true;
                    }
                    else
                    {
                        // Not approved or timeout — toolResultContent/toolResultIsError already set above
                        if (string.IsNullOrEmpty(toolResultContent))
                        {
                            toolResultContent = $"用户拒绝了工具 \"{toolCall.Name}\" 的执行。";
                            toolResultIsError = true;
                        }
                    }
                }
                else if (executor != null)
                {
                    (toolResultContent, toolResultIsError) = await ExecuteToolAsync(toolCall, executor, sessionTodos, jsonOptions, cancellationToken);
                }
                else
                {
                    toolResultContent = $"未找到工具: {toolCall.Name}";
                    toolResultIsError = true;
                }

                // Emit tool_result event
                var trEvent = System.Text.Json.JsonSerializer.Serialize(new
                {
                    type = "tool_result",
                    id = toolCall.Id,
                    name = toolCall.Name,
                    content = toolResultContent,
                    isError = toolResultIsError,
                    collapsed = approval == ToolApprovalMode.Bypass,
                    hidden = isSilentTool
                }, jsonOptions);
                await Response.WriteAsync($"data: {trEvent}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);

                // Add tool result to message history
                chatMessages.Add(new LlmChatMessage
                {
                    Role = "tool",
                    ToolCallId = toolCall.Id,
                    Content = toolResultContent
                });
            }

            // Continue the while loop — LLM will see tool results and respond
        }

        // Save the final assistant message (from last iteration)
        // Skip saving when the LLM only invoked tools (e.g. todo) without producing any text —
        // otherwise an empty assistant bubble would appear in the UI.
        var finalContent = contentSb.ToString().Trim();
        if (!string.IsNullOrEmpty(finalContent))
        {
            await _chatMessageService.SaveAssistantMessageAsync(topicId, contentSb.ToString(), modelId, thinkingSb.Length > 0 ? thinkingSb.ToString() : null, searchResultsJson, knowledgeResultsJson, memoryResultsJson, cancellationToken);
        }

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

/// <summary>
/// Per-stream todo item tracked by the Agent Loop so the todo tool can return
/// the actual state (with resolved ids) back to the LLM.
/// </summary>
internal class SessionTodo
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Status { get; set; } = "not-started";
}
