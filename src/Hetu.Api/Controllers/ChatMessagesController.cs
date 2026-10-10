using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Hetu.Api.Services;
using Hetu.Api.Streaming;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Hetu.Core.Utilities;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Hetu.Shared.Context;
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
    private readonly IMemoryService _memoryService;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalSkillService _localSkillService;
    private readonly MentionContextBuilder _mentionContext;
    private readonly ChatContextInjector _contextInjector;
    private readonly ToolRegistry _toolRegistry;
    private readonly PromptComposer _promptComposer;
    private readonly ToolExecutionService _toolExecution;
    private readonly AgentLoopService _agentLoop;
    private readonly ILlmUsageRecorder _llmUsageRecorder;
    private readonly ContextCompactionService _contextCompaction;
    private readonly ILogger<ChatMessagesController> _logger;
    private readonly ILocalizer _localizer;

    public ChatMessagesController(
        IChatMessageService chatMessageService,
        IChatTopicService chatTopicService,
        ILLMProviderFactory llmProviderFactory,
        IMemoryService memoryService,
        IUnitOfWork unitOfWork,
        ILocalSkillService localSkillService,
        MentionContextBuilder mentionContext,
        ChatContextInjector contextInjector,
        ToolRegistry toolRegistry,
        PromptComposer promptComposer,
        ToolExecutionService toolExecution,
        AgentLoopService agentLoop,
        ILlmUsageRecorder llmUsageRecorder,
        ContextCompactionService contextCompaction,
        ILogger<ChatMessagesController> logger,
        ILocalizer localizer)
    {
        _chatMessageService = chatMessageService;
        _chatTopicService = chatTopicService;
        _llmProviderFactory = llmProviderFactory;
        _memoryService = memoryService;
        _unitOfWork = unitOfWork;
        _localSkillService = localSkillService;
        _mentionContext = mentionContext;
        _contextInjector = contextInjector;
        _toolRegistry = toolRegistry;
        _promptComposer = promptComposer;
        _toolExecution = toolExecution;
        _agentLoop = agentLoop;
        _llmUsageRecorder = llmUsageRecorder;
        _contextCompaction = contextCompaction;
        _logger = logger;
        _localizer = localizer;
    }

    [HttpGet("topic/{topicId:guid}")]
    public Task<ApiResponse<List<ChatMessageDto>>> GetByTopic(Guid topicId, CancellationToken ct)
        => _chatMessageService.GetByTopicAsync(topicId, ct);

    [HttpGet("search")]
    public Task<ApiResponse<List<ChatMessageSearchResultDto>>> Search(
        [FromQuery] string keyword, [FromQuery] Guid? topicId = null,
        [FromQuery] Guid? groupId = null, CancellationToken ct = default)
        => _chatMessageService.SearchAsync(keyword, topicId, groupId, ct);

    /// <summary>上下文占用：窗口大小 + 系统提示/历史/摘要分块（供输入框右侧会话信息面板）</summary>
    [HttpGet("topic/{topicId:guid}/context-usage")]
    public Task<ApiResponse<ContextUsageDto>> GetContextUsage(
        Guid topicId, [FromQuery] int? contextWindow, CancellationToken ct)
        => _contextCompaction.GetChatUsageAsync(topicId, contextWindow, ct);

    /// <summary>手动压缩上下文（/compress）：调用当前大模型把较早的历史压成摘要</summary>
    [HttpPost("topic/{topicId:guid}/compact")]
    public Task<ApiResponse<CompactContextResultDto>> Compact(
        Guid topicId, [FromBody] CompactContextRequest request, CancellationToken ct)
        => _contextCompaction.CompactChatAsync(topicId, request ?? new CompactContextRequest(), ct);

    /// <summary>清除上下文摘要，恢复完整历史</summary>
    [HttpDelete("topic/{topicId:guid}/compact")]
    public async Task<ApiResponse> ClearCompact(Guid topicId, CancellationToken ct)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, ct);
        if (topic == null) return ApiResponse.Fail(_localizer.T("chat.topicNotFound"));
        topic.ContextSummary = null;
        topic.ContextSummaryThroughMessageId = null;
        await _unitOfWork.ChatTopics.UpdateAsync(topic, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse.Ok();
    }

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
        return ApiResponse.Fail(_localizer.T("chat.questionNotFound"));
    }

    [HttpPost("approve")]
    public ApiResponse SubmitApproval([FromBody] ApprovalRequest request)
    {
        if (_toolExecution.TrySetApproval(request.SessionId, request.ToolCallId, request.Approve))
            return ApiResponse.Ok();
        return ApiResponse.Fail(_localizer.T("chat.approvalNotFound"));
    }

    [HttpPost("plan")]
    public ApiResponse SubmitPlanDecision([FromBody] PlanDecisionRequest request)
    {
        if (_toolExecution.TrySetPlanDecision(request.SessionId, request.ToolCallId, request.Approved, request.Feedback ?? string.Empty))
            return ApiResponse.Ok();
        return ApiResponse.Fail(_localizer.T("chat.planNotFound"));
    }

    [HttpPost("topic/{topicId:guid}/stream")]
    public async Task Stream(Guid topicId, [FromBody] SendMessageRequest request, CancellationToken ct = default)
    {
        Response.StartSseStream();

        var writer = new SseStreamWriter(Response, ct);

        Log.Debug("[Stream] content={Content}, enableTools={EnableTools}",
            request.Content?.Length > 50 ? request.Content[..50] + "..." : request.Content, request.EnableTools);

        var topicResult = await _chatTopicService.GetByIdAsync(topicId, ct);
        if (!topicResult.Success || topicResult.Data == null) { await writer.WriteErrorAsync(topicResult.Error ?? _localizer.T("chat.topicNotFound")); return; }
        var topic = topicResult.Data;

        var userMsgResult = await _chatMessageService.CreateUserMessageAsync(topicId, request.Content ?? "", ct);
        if (!userMsgResult.Success) { await writer.WriteErrorAsync(userMsgResult.Error ?? _localizer.T("chat.messageCreateFailed")); return; }

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
        if (provider == null) { await writer.WriteErrorAsync(_localizer.T("chat.modelUnavailable")); return; }

        var (chatMessages, autoCompacted) = await BuildChatHistoryAsync(topicId, request, provider, ct);
        if (autoCompacted)
        {
            await writer.WriteJsonAsync(new { type = "notice", kind = "compacted", text = _localizer.T("chat.contextCompacted") });
        }
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

        var (searchJson, kbJson, memJson) = await InjectRagAsync(topicId, request, chatMessages, writer, provider, ct);
        await InjectMentionsAsync(request, chatMessages, writer, ct);

        var profile = BuiltinProfiles.Knowledge;
        var (useToolCalling, approvalOverrides) = ConfigureToolCalling(request, profile, options);

        var sw = Stopwatch.StartNew();
        int estimatedInput = 0, estimatedCompressed = 0;
        var sink = new SseAgentSink(writer, _localizer);

        var loopResult = await _agentLoop.RunAsync(new AgentLoopRequest
        {
            // Provider 已在上面解析（含 API Key 解密失败的友好报错），此处复用同一实例
            ModelId = modelId,
            SystemPrompt = options.SystemPrompt ?? string.Empty,
            Messages = chatMessages,
            ToolNames = useToolCalling ? options.Tools?.Select(t => t.Name).ToList() ?? new List<string>() : new List<string>(),
            McpServerIds = new List<Guid>(),
            MaxIterations = profile.MaxAgentIterations,
            MaxToolCallsPerTurn = profile.MaxToolCallsPerTurn,
            ToolApprovals = approvalOverrides,
            SessionId = topicId.ToString(),
            Sink = sink,
            EnableTools = useToolCalling,
            // 常驻工具集：其余工具只在系统提示里列名，模型用 load_tools 按需加载 schema（省上下文固定开销）
            CoreToolNames = BuiltinProfiles.KnowledgeCoreTools,
            // 权限模式与编码会话共用五档语义（plan/readonly/ask/auto/bypass），
            // 由统一策略按工具风险等级折算；未指定时回落到 ask（写操作需确认）
            DecideToolCall = useToolCalling
                ? AgentToolPolicy.CreateDecider(
                    _toolRegistry,
                    new AgentPolicyContext { Mode = WorkToolPolicy.Parse(request.PermissionMode) })
                : null,
            Hooks = new ChatEstimateHooks(chatMessages, options, v => estimatedInput = v, v => estimatedCompressed = v),
        }, ct);

        sw.Stop();
        var latencyMs = (int)sw.ElapsedMilliseconds;
        var cancelled = loopResult.Cancelled;
        var loopError = loopResult.Error;

        // 中断或正常完成都保存已生成的部分内容
        var finalContent = loopResult.Content;
        if (cancelled)
            finalContent += _localizer.T("chat.stoppedGenerating");
        else if (finalContent.Trim().Length == 0 && loopError != null)
            finalContent = _localizer.T("chat.requestFailed", loopError);
        // 模型只调用工具、没有正文（如 todo / plan / ask_question 之后直接结束）时也要落库，
        // 否则该轮在消息列表里完全不可见，历史也丢失这轮上下文（与编码会话同一处理）
        else if (finalContent.Trim().Length == 0 && loopResult.ToolCalls.Count > 0)
            finalContent = _localizer.T("chat.noOutputWithTools", string.Join("、", loopResult.ToolCalls.Select(t => t.Name).Distinct()));

        if (!string.IsNullOrEmpty(finalContent))
        {
            var toolCallsJson = loopResult.Timeline.Count > 0
                ? JsonSerializer.Serialize(loopResult.Timeline, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })
                : null;
            await _chatMessageService.SaveAssistantMessageAsync(topicId,
                finalContent, modelId,
                !string.IsNullOrEmpty(loopResult.Thinking) ? loopResult.Thinking : null,
                searchJson, kbJson, memJson,
                loopResult.Usage.TotalTokens > 0 ? loopResult.Usage.TotalTokens : null,
                loopResult.Usage.CachedTokens > 0 ? loopResult.Usage.CachedTokens : null,
                latencyMs,
                inputTokens: estimatedInput,
                compressedTokens: estimatedCompressed,
                outputTokens: loopResult.Usage.CompletionTokens > 0 ? loopResult.Usage.CompletionTokens : null,
                toolCallsJson: toolCallsJson,
                cancellationToken: CancellationToken.None);
        }

        await _llmUsageRecorder.RecordAsync(
            LlmUsageSources.Chat,
            loopResult.Usage.TotalTokens > 0 ? loopResult.Usage : null,
            refId: topicId,
            modelId: modelId,
            // 输入的「压缩前 / 压缩后」：优先记压缩管道的实际规模（有压缩时才非零），否则退回请求规模估算
            inputTokens: loopResult.FirstIterationInputChars > 0
                ? LlmTokenEstimator.EstimateChars(loopResult.FirstIterationInputChars)
                : estimatedInput,
            compressedTokens: loopResult.FirstIterationCompressedChars > 0
                ? LlmTokenEstimator.EstimateChars(loopResult.FirstIterationCompressedChars)
                : estimatedCompressed,
            latencyMs: latencyMs,
            contentPreview: request.Content,
            ct: CancellationToken.None);

        if (!cancelled && request.Memory)
        {
            try { await _memoryService.TryAutoExtractAsync(topicId, ct); } catch { }
        }
    }

    /// <summary>把 Agent Loop 事件写进 SSE 流。</summary>
    private sealed class SseAgentSink : IAgentLoopSink
    {
        private readonly SseStreamWriter _writer;
        private readonly ILocalizer _localizer;

        public SseAgentSink(SseStreamWriter writer, ILocalizer localizer) => (_writer, _localizer) = (writer, localizer);

        public Task OnContentAsync(string text) => _writer.WriteJsonAsync(new { type = "content", text });

        public Task OnThinkingAsync(string text) => _writer.WriteJsonAsync(new { type = "thinking", text });

        public Task OnDebugAsync(string text) => _writer.WriteDebugAsync(text);

        public Task OnErrorAsync(string message) => _writer.WriteErrorAsync(_localizer.T("chat.requestFailed", message));

        /// <summary>tool_call / tool_result / approval_request / question / todo / plan 一律直通写帧</summary>
        public Task OnEventAsync(object payload) => _writer.WriteJsonAsync(payload);

        public Task OnUsageAsync(LlmUsage usage) => Task.CompletedTask;
    }

    /// <summary>对话页的 token 估算钩子：每轮估算本轮请求的上下文规模（不累加）。</summary>
    private sealed class ChatEstimateHooks : IAgentLoopHooks
    {
        private readonly List<LlmChatMessage> _messages;
        private readonly ChatOptions _options;
        private readonly Action<int> _setInput;
        private readonly Action<int> _setCompressed;

        public ChatEstimateHooks(
            List<LlmChatMessage> messages,
            ChatOptions options,
            Action<int> setInput,
            Action<int> setCompressed)
        {
            _messages = messages;
            _options = options;
            _setInput = setInput;
            _setCompressed = setCompressed;
        }

        public Task OnIterationAsync(int iteration, string content, string thinking, LlmUsage? usage)
        {
            // 只记本轮「首次请求」的上下文规模，不是逐轮累加：
            // 累加等于把「系统提示与工具」按迭代次数放大，上下文占用面板正是用它反推固定开销
            // （越用越大，并会提前触发自动压缩）。
            if (iteration == 0)
            {
                var tokens = EstimateTokens(_messages, _options);
                _setInput(tokens);
                _setCompressed(tokens);
            }
            return Task.CompletedTask;
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

    /// <summary>
    /// 构建本轮对话历史：先按需自动压缩（超限），再跳过已被摘要覆盖的消息、把摘要置于最前，
    /// 最后按会话级上下文预算裁剪最早的若干条。
    /// </summary>
    private async Task<(List<LlmChatMessage> Messages, bool AutoCompacted)> BuildChatHistoryAsync(
        Guid topicId, SendMessageRequest request, ILLMProvider provider, CancellationToken ct)
    {
        int? ctxSize = null;
        var ctxSetting = await _unitOfWork.AppSettings.GetByKeyAsync("ContextWindowSize", ct);
        if (!string.IsNullOrWhiteSpace(ctxSetting?.Value) && int.TryParse(ctxSetting.Value, out var v))
            ctxSize = v;

        var history = await _chatMessageService.BuildHistoryAsync(topicId, ctxSize, ct);

        // 上下文超限自动压缩：占用达到窗口 80% 时先用当前模型压出摘要，再继续本轮
        var autoSummary = await _contextCompaction.TryAutoCompactChatAsync(topicId, request.ContextWindow, ct);
        var autoCompacted = autoSummary != null;
        if (autoCompacted) _logger.LogInformation("[Context] 自动压缩生效 topicId={TopicId}", topicId);

        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, ct);
        autoSummary ??= topic?.ContextSummary;
        var throughId = topic?.ContextSummaryThroughMessageId;
        if (throughId is { } tid && tid != Guid.Empty)
        {
            var index = history.ToList().FindIndex(m => m.Id == tid);
            if (index >= 0) history = history.Skip(index + 1).ToList();
        }

        var messages = history.Select(m => new LlmChatMessage { Role = m.Role, Content = m.Content }).ToList();
        if (!string.IsNullOrWhiteSpace(autoSummary))
        {
            messages.Insert(0, new LlmChatMessage
            {
                Role = "user",
                Content = $"（以下是此前对话的压缩摘要，原文已不再随上下文发送，可据此继续）\n{autoSummary}"
            });
        }

        // 会话级上下文上限（token）：按 ~3 字符/token 折算成字符预算，从最早的消息开始裁剪
        if (request.ContextWindow is > 0)
        {
            var charBudget = (long)request.ContextWindow.Value * 3;
            var total = messages.Sum(m => (long)(m.Content?.Length ?? 0));
            var start = 0;
            while (start < messages.Count - 1 && total > charBudget)
            {
                total -= messages[start].Content?.Length ?? 0;
                start++;
            }
            if (start > 0)
            {
                messages = messages.Skip(start).ToList();
                _logger.LogInformation(
                    "[Context] 上下文上限 {Window} tokens：裁剪历史消息，保留 {Kept}/{Total} 条（约 {Chars} 字符）",
                    request.ContextWindow, messages.Count, messages.Count + start, total);
            }
        }

        if (request.Images is { Count: > 0 })
        {
            ChatContextInjector.AttachImages(request.Images, provider, messages);
        }
        return (messages, autoCompacted);
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
            ChatContextInjector.ApplyDeepThinking(true, reasoningMode, options);
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
        var resolved = await _mentionContext.BuildAsync(request.Mentions, messages, ct);
        if (resolved > 0) await writer.WriteJsonAsync(new { type = "mentions", count = resolved });
    }

    private async Task<(string? search, string? knowledge, string? memory)> InjectRagAsync(
        Guid topicId, SendMessageRequest request, List<LlmChatMessage> messages, SseStreamWriter writer, ILLMProvider provider, CancellationToken ct)
    {
        // 对话会话：记忆作用域 = 全局 ∪ 当前会话（对话话题没有项目绑定）
        var result = await _contextInjector.InjectRagAsync(
            request.WebSearch, request.KnowledgeBase, request.Memory, request.Content ?? string.Empty, messages, writer, provider,
            topicId, projectId: null, ct);
        return (result.SearchJson, result.KnowledgeJson, result.MemoryJson);
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

    /// <summary>按字符数粗略估算一轮请求的 token 数（消息 + 系统提示 + 工具 schema）</summary>
    private static int EstimateTokens(List<LlmChatMessage> messages, ChatOptions options)
        => LlmTokenEstimator.EstimateRequestTokens(messages, options.SystemPrompt, options.Tools);
}