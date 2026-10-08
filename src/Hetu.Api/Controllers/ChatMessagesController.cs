using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Hetu.Api.Streaming;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Core.Utilities;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;
using Serilog;

namespace Hetu.Api.Controllers;

/// <summary>
/// 持久化到助手消息的瀑布流片段：按模型"文本 → 工具调用"的实际发生顺序记录，
/// 前端据此穿插还原（旧格式为无 kind 的纯工具数组，前端兼容处理）。
/// </summary>
public class TimelineSegment
{
    /// <summary>text | tool</summary>
    public string Kind { get; set; } = "text";
    public string? Content { get; set; }
    public string? Name { get; set; }
    public string? Arguments { get; set; }
    public string? Result { get; set; }
    public bool IsError { get; set; }
}

[ApiController]
[Route("api/chat-messages")]
public class ChatMessagesController : ControllerBase
{
    private readonly IChatMessageService _chatMessageService;
    private readonly IChatTopicService _chatTopicService;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly IWebSearchService _webSearchService;
    private readonly SearchQueryRewriter _queryRewriter;
    private readonly ISemanticSearchService _semanticSearchService;
    private readonly IMemoryService _memoryService;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalSkillService _localSkillService;
    private readonly INoteService _noteService;
    private readonly INotebookService _notebookService;
    private readonly ITagService _tagService;
    private readonly ToolRegistry _toolRegistry;
    private readonly PromptComposer _promptComposer;
    private readonly ToolExecutionService _toolExecution;
    private readonly CompressionPipelineService _compressionPipeline;

    public ChatMessagesController(
        IChatMessageService chatMessageService,
        IChatTopicService chatTopicService,
        ILLMProviderFactory llmProviderFactory,
        IWebSearchService webSearchService,
        SearchQueryRewriter queryRewriter,
        ISemanticSearchService semanticSearchService,
        IMemoryService memoryService,
        IUnitOfWork unitOfWork,
        ILocalSkillService localSkillService,
        INoteService noteService,
        INotebookService notebookService,
        ITagService tagService,
        ToolRegistry toolRegistry,
        PromptComposer promptComposer,
        ToolExecutionService toolExecution,
        CompressionPipelineService compressionPipeline)
    {
        _chatMessageService = chatMessageService;
        _chatTopicService = chatTopicService;
        _llmProviderFactory = llmProviderFactory;
        _webSearchService = webSearchService;
        _queryRewriter = queryRewriter;
        _semanticSearchService = semanticSearchService;
        _memoryService = memoryService;
        _unitOfWork = unitOfWork;
        _localSkillService = localSkillService;
        _noteService = noteService;
        _notebookService = notebookService;
        _tagService = tagService;
        _toolRegistry = toolRegistry;
        _promptComposer = promptComposer;
        _toolExecution = toolExecution;
        _compressionPipeline = compressionPipeline;
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

    [HttpPost("plan")]
    public ApiResponse SubmitPlanDecision([FromBody] PlanDecisionRequest request)
    {
        if (_toolExecution.TrySetPlanDecision(request.SessionId, request.ToolCallId, request.Approved, request.Feedback ?? string.Empty))
            return ApiResponse.Ok();
        return ApiResponse.Fail("未找到对应的计划确认请求");
    }

    [HttpPost("topic/{topicId:guid}/stream")]
    public async Task Stream(Guid topicId, [FromBody] SendMessageRequest request, CancellationToken ct = default)
    {
        Response.StartSseStream();

        var writer = new SseStreamWriter(Response, ct);

        Log.Debug("[Stream] content={Content}, enableTools={EnableTools}",
            request.Content?.Length > 50 ? request.Content[..50] + "..." : request.Content, request.EnableTools);

        var topicResult = await _chatTopicService.GetByIdAsync(topicId, ct);
        if (!topicResult.Success || topicResult.Data == null) { await writer.WriteErrorAsync(topicResult.Error ?? "话题不存在"); return; }
        var topic = topicResult.Data;

        var userMsgResult = await _chatMessageService.CreateUserMessageAsync(topicId, request.Content ?? "", ct);
        if (!userMsgResult.Success) { await writer.WriteErrorAsync(userMsgResult.Error ?? "创建消息失败"); return; }

        await MarkTopicOutdatedIfNeededAsync(topic, topicId, ct);

        var agentPreset = await ResolveAgentPresetAsync(request.AgentId, ct);
        // 专业智能体可绑定模型：请求未指定模型时，优先于话题默认模型
        (ILLMProvider? Provider, Guid? ModelId) resolved;
        try
        {
            resolved = await _llmProviderFactory.ResolveAsync(
                request.ModelId, agentPreset?.ModelId ?? topic.ModelId, ct);
        }
        catch (Exception ex)
        {
            // 模型解析异常（如 API Key 解密失败）转为 SSE 错误帧，前端可直接展示
            await writer.WriteErrorAsync(ex.Message.Split('\n')[0]);
            return;
        }
        var (provider, modelId) = resolved;
        if (provider == null) { await writer.WriteErrorAsync("未找到可用的对话模型"); return; }

        var chatMessages = await BuildChatHistoryAsync(topicId, request, provider, ct);
        var options = await BuildChatOptionsAsync(request, topic, modelId, agentPreset, ct);

        // 技能的 promptTemplate 组装进本轮用户消息：{{input}} 替换为 /name 之后的入参
        if (!string.IsNullOrWhiteSpace(request.SkillName))
        {
            var skillTemplate = (await ResolveSkillAsync(request.SkillName, ct)).PromptTemplate;
            if (!string.IsNullOrWhiteSpace(skillTemplate))
            {
                var skillInput = ExtractSkillInput(request.Content, request.SkillName);
                var composed = skillTemplate.Contains("{{input}}", StringComparison.Ordinal)
                    ? skillTemplate.Replace("{{input}}", skillInput)
                    : $"{skillTemplate}\n\n{skillInput}";
                for (var i = chatMessages.Count - 1; i >= 0; i--)
                {
                    if (chatMessages[i].Role != "user") continue;
                    chatMessages[i] = new LlmChatMessage { Role = "user", Content = composed };
                    break;
                }
            }
        }

        var (searchJson, kbJson, memJson) = await InjectRagAsync(request, chatMessages, writer, provider, ct);
        await InjectMentionsAsync(request, chatMessages, writer, ct);

        var profile = BuiltinProfiles.Knowledge;
        var (useToolCalling, approvalOverrides) = ConfigureToolCalling(request, profile, options);

        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        var timeline = new List<TimelineSegment>();
        var sessionTodos = new List<SessionTodo>();
        const int maxIterations = 15;
        var maxIter = profile.MaxAgentIterations > 0 ? profile.MaxAgentIterations : maxIterations;
        var sw = Stopwatch.StartNew();
        int totalTokens = 0, cachedTokens = 0, totalPrompt = 0, totalCompletion = 0, estimatedInput = 0, estimatedCompressed = 0;
        bool hasUsage = false;
        var cancelled = false;
        string? loopError = null;

        try
        {
            for (int iter = 0; iter < maxIter; iter++)
            {
                // 1. 压缩前估算原始 Token
                estimatedInput += EstimateTokens(chatMessages, options);

                // 2. 压缩本轮消息并估算压缩后 Token
                await CompressChatHistoryAsync(chatMessages, options, ct);
                estimatedCompressed += EstimateTokens(chatMessages, options);

                // 3. LLM 调用
                await writer.WriteDebugAsync($"Iteration {iter + 1}, tools={options.Tools?.Count ?? 0}");

                var (iterContent, iterThinking, pendingToolCalls, iterUsage) = await ChatStreamProcessor.ProcessStreamAsync(
                    provider, chatMessages, options, writer, ct);

                if (iterUsage != null)
                {
                    hasUsage = true;
                    totalTokens += iterUsage.TotalTokens;
                    totalPrompt += iterUsage.PromptTokens;
                    totalCompletion += iterUsage.CompletionTokens;
                    cachedTokens += iterUsage.CachedTokens;
                }

                if (pendingToolCalls == null || pendingToolCalls.Count == 0 || !useToolCalling)
                {
                    contentSb.Append(iterContent);
                    thinkingSb.Append(iterThinking);
                    break;
                }

                contentSb.Append(iterContent);
                thinkingSb.Append(iterThinking);

                // 有序流水：本轮按 思考 → 文本 → 工具调用 的发生顺序记录，前端才能穿插还原
                if (iterThinking.Length > 0)
                    timeline.Add(new TimelineSegment { Kind = "thought", Content = iterThinking.ToString() });
                if (iterContent.Length > 0)
                    timeline.Add(new TimelineSegment { Kind = "text", Content = iterContent.ToString() });

                // 4. 追加新消息（下一轮会压缩）
                chatMessages.Add(new LlmChatMessage { Role = "assistant", Content = iterContent.ToString(), ToolCalls = pendingToolCalls });

                var toolResults = await _toolExecution.ExecuteToolCallsAsync(
                    topicId.ToString(),
                    pendingToolCalls, approvalOverrides, sessionTodos,
                    data => writer.WriteEventAsync(data),
                    payload => writer.WriteJsonAsync(payload),
                    ct);

                foreach (var (toolCallId, content, _) in toolResults)
                {
                    chatMessages.Add(new LlmChatMessage { Role = "tool", ToolCallId = toolCallId, Content = content });
                }

                // 记录工具调用流水，随助手消息持久化（前端瀑布流还原执行过程）
                foreach (var (toolCallId, toolContent, isError) in toolResults)
                {
                    var call = pendingToolCalls.FirstOrDefault(c => c.Id == toolCallId);
                    if (call == null) continue;
                    timeline.Add(new TimelineSegment
                    {
                        Kind = "tool",
                        Name = call.Name,
                        Arguments = call.Arguments,
                        Result = toolContent,
                        IsError = isError,
                    });
                }
            }
        }
        catch (OperationCanceledException)
        {
            cancelled = true;
            Log.Information("[Stream] 用户中断生成 topicId={TopicId}", topicId);
        }
        catch (Exception ex)
        {
            loopError = ex.Message;
            Log.Error(ex, "[Stream] Agent循环异常 topicId={TopicId}", topicId);
            try { await writer.WriteErrorAsync($"处理请求时出错: {ex.Message}"); } catch { }
        }

        sw.Stop();
        var latencyMs = (int)sw.ElapsedMilliseconds;

        // 中断或正常完成都保存已生成的部分内容
        var finalContent = contentSb.ToString();
        if (cancelled)
            finalContent += "\n\n*（已停止生成）*";
        else if (finalContent.Trim().Length == 0 && loopError != null)
            finalContent = $"处理请求时出错: {loopError}";

        if (!string.IsNullOrEmpty(finalContent))
        {
            var toolCallsJson = timeline.Count > 0
                ? JsonSerializer.Serialize(timeline, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })
                : null;
            await _chatMessageService.SaveAssistantMessageAsync(topicId,
                finalContent, modelId,
                thinkingSb.Length > 0 ? thinkingSb.ToString() : null,
                searchJson, kbJson, memJson,
                hasUsage ? totalTokens : null,
                hasUsage ? cachedTokens : null,
                latencyMs,
                inputTokens: estimatedInput,
                compressedTokens: estimatedCompressed,
                outputTokens: hasUsage ? totalCompletion : null,
                toolCallsJson: toolCallsJson,
                cancellationToken: CancellationToken.None);
        }

        if (!cancelled && request.Memory)
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
        SendMessageRequest request, ChatTopicDto topic, Guid? modelId, PromptPreset? agentPreset, CancellationToken ct)
    {
        // ModelId 留空：provider 创建时已注入正确的模型名（_modelId），
        // 这里的 modelId 是数据库主键 Guid，绝不能当模型名发给 LLM。
        var options = new ChatOptions { Stream = true };
        var profile = BuiltinProfiles.Knowledge;

        string? skillPrompt = null;
        if (!string.IsNullOrWhiteSpace(request.SkillName))
            skillPrompt = (await ResolveSkillAsync(request.SkillName, ct)).SystemPrompt;

        var assistantName = (await _unitOfWork.AppSettings.GetByKeyAsync("AssistantName", ct))?.Value;
        var assistantPersona = (await _unitOfWork.AppSettings.GetByKeyAsync("AssistantPersona", ct))?.Value;

        options.SystemPrompt = _promptComposer.Compose(new PromptComposeContext
        {
            Profile = profile,
            AgentPresetPrompt = request.PresetSystemPrompt,
            SkillPrompt = skillPrompt,
            TopicCustomPrompt = topic.CustomSystemPrompt,
            AssistantName = assistantName,
            AssistantPersona = assistantPersona,
            EnabledTools = request.EnableTools ? request.EnabledTools : null,
            Now = DateTimeOffset.Now,
            TopicTitle = topic.Title,
            Locale = "zh-CN",
        });

        if (agentPreset != null && string.Equals(agentPreset.AgentType, "Professional", StringComparison.OrdinalIgnoreCase))
        {
            var capabilityPrompt = await BuildProfessionalCapabilityPromptAsync(agentPreset, ct);
            if (!string.IsNullOrWhiteSpace(capabilityPrompt))
            {
                Log.Debug("[Agent] professional agent={AgentId} capability={Capability}", agentPreset.Id, capabilityPrompt);
                options.SystemPrompt += "\n\n" + capabilityPrompt;
            }
        }

        await ApplyDeepThinkingAsync(request, options, modelId, agentPreset?.ReasoningEffort);
        return options;
    }

    /// <summary>
    /// 解析前端选择的智能体（AgentId）。本地/非法 ID 返回 null，回落到仅用 PresetSystemPrompt 的行为。
    /// </summary>
    private async Task<PromptPreset?> ResolveAgentPresetAsync(string? agentId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(agentId) || !Guid.TryParse(agentId, out var id)) return null;
        return await _unitOfWork.PromptPresets.GetByIdAsync(id, ct);
    }

    /// <summary>
    /// 组装专业智能体的能力说明：可管理的子智能体 + 可使用的技能，注入系统提示词。
    /// 技能支持数据库技能（Guid）与本地技能（local: 前缀 ID / 名称）。
    /// </summary>
    private async Task<string?> BuildProfessionalCapabilityPromptAsync(PromptPreset agent, CancellationToken ct)
    {
        var subAgentIds = ParseGuidList(agent.SubAgentIds);
        var skillRefs = ParseStringList(agent.SkillIds);
        if (subAgentIds.Count == 0 && skillRefs.Count == 0) return null;

        var sb = new StringBuilder();
        sb.AppendLine("# 专业智能体能力");

        if (subAgentIds.Count > 0)
        {
            var subAgents = (await _unitOfWork.PromptPresets.GetAllAsync(ct))
                .Where(p => subAgentIds.Contains(p.Id) && p.Id != agent.Id)
                .OrderBy(p => p.SortOrder)
                .ToList();
            if (subAgents.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("## 可管理的子智能体");
                foreach (var sub in subAgents)
                    sb.AppendLine($"- {sub.Name}（{sub.Category}）");
                sb.AppendLine("处理匹配某个子智能体专业领域的子任务时，以该子智能体的人设与职责范围内执行；不越出其能力范围。");
            }
        }

        if (skillRefs.Count > 0)
        {
            var dbSkillGuids = skillRefs
                .Where(r => Guid.TryParse(r, out _))
                .Select(Guid.Parse)
                .ToHashSet();
            var localResult = await _localSkillService.ScanAllAsync(ct);
            var localSkills = localResult.Data ?? [];

            var lines = new List<string>();
            if (dbSkillGuids.Count > 0)
            {
                var dbSkills = (await _unitOfWork.Skills.GetAllAsync(ct))
                    .Where(s => s.IsEnabled && dbSkillGuids.Contains(s.Id))
                    .OrderBy(s => s.SortOrder)
                    .ToList();
                lines.AddRange(dbSkills.Select(s => $"- /{s.Name}：{s.Description}"));
            }

            // 非 Guid 的引用按本地技能匹配：local:{dir}:{name} 或技能名
            var localRefs = skillRefs.Where(r => !Guid.TryParse(r, out _)).ToList();
            foreach (var name in localRefs
                .Select(refId => localSkills.FirstOrDefault(s => s.Id == refId)?.Name ?? refId)
                .Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var skill = localSkills.FirstOrDefault(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase) && s.IsEnabled);
                if (skill != null) lines.Add($"- /{skill.Name}：{skill.Description}（本地）");
            }

            if (lines.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("## 可使用的技能");
                foreach (var line in lines) sb.AppendLine(line);
                sb.AppendLine("仅允许使用以上列出的技能；用户请求其他技能时，说明当前智能体无权使用该技能，建议切换到对应智能体。");
            }
        }

        return sb.ToString().TrimEnd();
    }

    private static List<Guid> ParseGuidList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<Guid>();
        try
        {
            return JsonSerializer.Deserialize<List<Guid>>(json, JsonDefaults.CaseInsensitive) ?? new List<Guid>();
        }
        catch (JsonException)
        {
            return new List<Guid>();
        }
    }

    /// <summary>解析混合 ID 列表（数据库 Guid 与本地技能 local: 前缀 ID）</summary>
    private static List<string> ParseStringList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try
        {
            return (JsonSerializer.Deserialize<List<string>>(json, JsonDefaults.CaseInsensitive) ?? new List<string>())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s.Trim())
                .ToList();
        }
        catch (JsonException)
        {
            return new List<string>();
        }
    }

    /// <summary>
    /// 解析技能（数据库技能优先，其次本地技能目录）：同时取出 systemPrompt 与 promptTemplate。
    /// 本地技能此前只用了 systemPrompt，SKILL.md 正文/指令模板被丢弃，导致"选得到但读不到"。
    /// </summary>
    private async Task<(string? SystemPrompt, string? PromptTemplate)> ResolveSkillAsync(string skillName, CancellationToken ct)
    {
        var skill = (await _unitOfWork.Skills.FindAsync(s => s.Name == skillName && s.IsEnabled, ct)).FirstOrDefault();
        string? config = skill?.Config;

        if (config == null)
        {
            var localResult = await _localSkillService.ScanAllAsync(ct);
            var local = (localResult.Data ?? [])
                .FirstOrDefault(s => s.IsEnabled && string.Equals(s.Name, skillName, StringComparison.OrdinalIgnoreCase))
                ?? (localResult.Data ?? []).FirstOrDefault(s => s.IsEnabled && s.Name.Contains(skillName, StringComparison.OrdinalIgnoreCase));
            config = local?.Config;
        }

        if (config == null) return (null, null);

        try
        {
            using var doc = JsonDocument.Parse(config);
            var root = doc.RootElement;
            // skill.json 的 config 可能是整棵技能树（含 name/description/config），向下再取一层
            if (root.TryGetProperty("config", out var nested) && nested.ValueKind == JsonValueKind.Object)
                root = nested;

            string? systemPrompt = null;
            if (root.TryGetProperty("systemPrompt", out var sp))
                systemPrompt = sp.GetString();

            string? promptTemplate = null;
            if (root.TryGetProperty("promptTemplate", out var pt))
                promptTemplate = pt.GetString();

            return (systemPrompt, promptTemplate);
        }
        catch (JsonException) { return (null, null); }
    }

    /// <summary>把用户消息里的 /skillName 前缀剥掉，得到技能入参</summary>
    private static string ExtractSkillInput(string? content, string skillName)
    {
        if (string.IsNullOrWhiteSpace(content)) return string.Empty;
        var trimmed = content.Trim();
        if (trimmed.StartsWith("/", StringComparison.Ordinal))
        {
            var rest = trimmed[1..];
            if (rest.StartsWith(skillName, StringComparison.OrdinalIgnoreCase))
            {
                var after = rest[skillName.Length..].Trim();
                return string.IsNullOrEmpty(after) ? string.Empty : after;
            }
        }
        return trimmed;
    }

    private async Task ApplyDeepThinkingAsync(SendMessageRequest request, ChatOptions options, Guid? modelId, string? agentReasoningEffort)
    {
        if (!request.DeepThinking && string.IsNullOrWhiteSpace(agentReasoningEffort)) return;

        AiModel? model = null;
        if (modelId.HasValue)
        {
            model = await _unitOfWork.AiModels.GetByIdAsync(modelId.Value);
        }
        var reasoningMode = model?.ReasoningMode ?? "none";
        if (reasoningMode == "none") return;

        if (reasoningMode == "tag")
        {
            options.SystemPrompt = (options.SystemPrompt ?? "") + "\n\n请在回答前先进行深度思考，展示你的推理过程。使用 <thinking> 标签包裹你的思考过程，然后给出最终回答。";
        }
        else if (reasoningMode == "native")
        {
            var effort = !string.IsNullOrWhiteSpace(request.ReasoningEffort) ? request.ReasoningEffort
                : !string.IsNullOrWhiteSpace(agentReasoningEffort) ? agentReasoningEffort
                : model?.ReasoningEffort;
            if (!string.IsNullOrWhiteSpace(effort)) options.ReasoningEffort = effort;
            if (model?.ReasoningBudgetTokens is > 0) options.ReasoningBudgetTokens = model.ReasoningBudgetTokens;
            Log.Debug("[Agent] reasoningEffort={Effort} (request={RequestEffort}, agent={AgentEffort}, model={ModelEffort})",
                options.ReasoningEffort, request.ReasoningEffort, agentReasoningEffort, model?.ReasoningEffort);
        }
    }

    /// <summary>
    /// 解析输入框 @ 引用（笔记 / 笔记本 / 标签 / 知识项），把内容作为上下文插入本轮对话。
    /// 与 RAG 注入一致：插在最后一条用户消息之前，模型可直接引用。
    /// </summary>
    private async Task InjectMentionsAsync(SendMessageRequest request, List<LlmChatMessage> messages, SseStreamWriter writer, CancellationToken ct)
    {
        if (request.Mentions is not { Count: > 0 }) return;

        var sb = new StringBuilder("以下是用户通过 @ 引用的内容（回复时必须优先结合这些内容）：");
        var resolved = 0;

        foreach (var mention in request.Mentions)
        {
            if (string.IsNullOrWhiteSpace(mention.Type) || !Guid.TryParse(mention.Id, out var id)) continue;

            switch (mention.Type.ToLowerInvariant())
            {
                case "note":
                {
                    var note = await _noteService.GetByIdAsync(id, ct);
                    if (note is { Success: true, Data: not null })
                    {
                        sb.AppendLine();
                        sb.AppendLine($"【笔记】{note.Data.Title}");
                        sb.AppendLine(note.Data.Content);
                        resolved++;
                    }
                    break;
                }
                case "notebook":
                {
                    var notebook = await _notebookService.GetByIdAsync(id, ct);
                    if (notebook is { Success: true, Data: not null })
                    {
                        var notes = await _noteService.GetListAsync(new GetNotesRequest { NotebookId = id, Page = 1, PageSize = 20 }, ct);
                        sb.AppendLine();
                        sb.AppendLine($"【笔记本】{notebook.Data.Name}");
                        if (notes is { Success: true, Data: not null })
                        {
                            foreach (var n in notes.Data.Items)
                                sb.AppendLine($"- {n.Title}");
                            resolved++;
                        }
                    }
                    break;
                }
                case "tag":
                {
                    var tag = await _tagService.GetByIdAsync(id, ct);
                    if (tag is { Success: true, Data: not null })
                    {
                        var notes = await _noteService.GetListAsync(new GetNotesRequest { TagId = id, Page = 1, PageSize = 20 }, ct);
                        sb.AppendLine();
                        sb.AppendLine($"【标签】{tag.Data.Name}");
                        if (notes is { Success: true, Data: not null })
                        {
                            foreach (var n in notes.Data.Items)
                                sb.AppendLine($"- {n.Title}");
                            resolved++;
                        }
                    }
                    break;
                }
                case "knowledge":
                {
                    var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, ct);
                    if (item != null)
                    {
                        sb.AppendLine();
                        sb.AppendLine($"【知识库】{item.Title}");
                        sb.AppendLine(item.Content);
                        resolved++;
                    }
                    break;
                }
            }
        }

        if (resolved == 0) return;

        await writer.WriteJsonAsync(new { type = "mentions", count = resolved });
        messages.Insert(Math.Max(0, messages.Count - 1),
            new LlmChatMessage { Role = "user", Content = sb.ToString().TrimEnd() });
    }

    private async Task<(string? search, string? knowledge, string? memory)> InjectRagAsync(
        SendMessageRequest request, List<LlmChatMessage> messages, SseStreamWriter writer, ILLMProvider provider, CancellationToken ct)
    {
        string? searchJson = null, kbJson = null, memJson = null;

        if (request.WebSearch)
        {
            // 查询改写：口语化原文直接搜很难命中，先提炼关键词再搜（复用当前会话模型，失败则用原文）
            var queries = await _queryRewriter.RewriteAsync(request.Content ?? string.Empty, provider, ct);

            var merged = new List<Hetu.Shared.Chat.WebSearchResultDto>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var q in queries)
            {
                foreach (var r in await _webSearchService.SearchAsync(q, 5, ct))
                {
                    if (seen.Add(r.Url)) merged.Add(r);
                }
                // 免费搜索源有配额限制：首个关键词够用就不再发起更多请求
                if (merged.Count >= 5) break;
            }
            var results = merged.Take(5).ToList();

            if (results.Count > 0)
            {
                await writer.WriteJsonAsync(new { type = "search_results", results });
                searchJson = JsonSerializer.Serialize(results, JsonDefaults.CamelCase);
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
                    kbJson = JsonSerializer.Serialize(items.Select(r => new { r.Title, r.ContentSnippet, r.Id }), JsonDefaults.CamelCase);
                    messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildKnowledgeContext(items) });
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "[Stream] 知识库检索失败");
            }
        }

        if (request.Memory)
        {
            try
            {
                var memories = await _memoryService.RetrieveForContextAsync(request.Content, 5, ct);
                if (memories.Count > 0)
                {
                    await writer.WriteJsonAsync(new { type = "memory_results", results = memories.Select(m => new { m.Id, m.Content, m.Category, m.Score }) });
                    memJson = JsonSerializer.Serialize(memories.Select(m => new { m.Id, m.Content, m.Category, m.Score }), JsonDefaults.CamelCase);
                    messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildMemoryContext(memories) });
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "[Stream] 记忆检索失败");
            }
        }

        return (searchJson, kbJson, memJson);
    }

    private (bool useToolCalling, Dictionary<string, ToolApprovalMode> overrides) ConfigureToolCalling(
        SendMessageRequest request, RuntimeProfile profile, ChatOptions options)
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

    /// <summary>按字符数粗略估算一轮请求的 token 数（约 3 字符 / token）</summary>
    private static int EstimateTokens(List<LlmChatMessage> messages, ChatOptions options)
    {
        var chars = messages.Sum(m => m.Content?.Length ?? 0)
            + (options.SystemPrompt?.Length ?? 0)
            + (options.Tools?.Sum(t => JsonSerializer.Serialize(t).Length) ?? 0);
        return (int)Math.Ceiling(chars / 3.0);
    }

    private async Task CompressChatHistoryAsync(List<LlmChatMessage> messages, ChatOptions options, CancellationToken ct)
    {
        for (int i = 0; i < messages.Count; i++)
        {
            var msg = messages[i];
            if (string.IsNullOrWhiteSpace(msg.Content) || msg.Content.Length < 500) continue;
            var compressed = await _compressionPipeline.CompressAsync(msg.Content, ct);
            if (compressed != msg.Content && !string.IsNullOrWhiteSpace(compressed))
                messages[i] = new LlmChatMessage { Role = msg.Role, Content = compressed, ContentParts = msg.ContentParts, ToolCallId = msg.ToolCallId, ToolCalls = msg.ToolCalls };
        }

        // 注意：不压缩 system prompt。其中的"当前时间"会被数字归一化把年份替换成 [N]，
        // 导致模型输出"当前（[N] 年 10 月 7 日）"这类错误日期；系统提示词是受控模板，压缩收益也甚微。
    }
}