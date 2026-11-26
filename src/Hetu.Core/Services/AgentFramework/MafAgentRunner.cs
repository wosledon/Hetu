using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Utilities;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MafChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Core.Services.AgentFramework;

/// <summary>
/// 基于 Microsoft Agent Framework 的 Agent 执行内核，负责把 Hetu 的工具、审批、压缩与 SSE 契约接入 MAF。
/// </summary>
public sealed class MafAgentRunner
{
    private static readonly ActivitySource ActivitySource = new("Hetu.AgentFramework");
    private const int DefaultMaxIterations = 15;
    private const int DefaultMaxToolCallsPerTurn = 5;
    private const int MaxToolResultCharsForModel = 8_000;
    private const int MaxToolErrorCharsForModel = 16_000;
    private const int MaxConcurrentCompressions = 3;
    private const int DefaultContextWindowTokens = 128_000;
    private const int HardCapPercent = 80;
    private const int AnchorPercent = 40;
    private const int MaxStalledIterations = 2;
    private const string SteeringPrefix = "【运行中引导，请立即结合它调整当前工作】\n";

    private readonly ToolRegistry _toolRegistry;
    private readonly ToolExecutionService _toolExecution;
    private readonly CompressionPipelineService _compressionPipeline;
    private readonly ContextCompactionService _contextCompaction;
    private readonly ILlmUsageRecorder _usageRecorder;
    private readonly ILogger<MafAgentRunner> _logger;
    private readonly ILocalizer _localizer;

    public MafAgentRunner(
        ToolRegistry toolRegistry,
        ToolExecutionService toolExecution,
        CompressionPipelineService compressionPipeline,
        ContextCompactionService contextCompactionService,
        ILlmUsageRecorder usageRecorder,
        ILogger<MafAgentRunner> logger,
        ILocalizer localizer)
    {
        _toolRegistry = toolRegistry;
        _toolExecution = toolExecution;
        _compressionPipeline = compressionPipeline;
        _contextCompaction = contextCompactionService;
        _usageRecorder = usageRecorder;
        _logger = logger;
        _localizer = localizer;
    }

    public async Task<AgentLoopResult> RunAsync(
        AgentLoopRequest request,
        ILLMProvider provider,
        IReadOnlyList<string> mcpToolNames,
        CancellationToken ct)
    {
        var state = new RunState(request, mcpToolNames);
        using var activity = ActivitySource.StartActivity("hetu.agent.run");
        activity?.SetTag("hetu.agent.session_id", request.SessionId);
        activity?.SetTag("hetu.agent.model_id", request.ModelId?.ToString());
        var sink = request.Sink ?? new NullAgentLoopSink();
        state.Sink = sink;
        state.Hooks = request.Hooks;
        state.Result = new AgentLoopResult();

        try
        {
            await PrepareHistoryAsync(state, ct);
            await BuildToolsAsync(state);

            var chatClient = new LlmProviderChatClient(
                provider,
                request.ProviderMaxRetries,
                request.ProviderRetryDelayMs,
                (usage, elapsed, finishReason, preview, toolCallCount, inputEstimate) =>
                    OnRequestCompletedAsync(state, usage, elapsed, finishReason, preview, toolCallCount, inputEstimate));
            var loopClient = new LoopChatClient(state, chatClient);
            var functionClient = new FunctionInvokingChatClient(loopClient, NullLoggerFactory.Instance, null)
            {
                MaximumIterationsPerRequest = int.MaxValue,
                AllowConcurrentInvocation = false,
                IncludeDetailedErrors = false,
                FunctionInvoker = (context, token) => InvokeToolAsync(state, context, token),
            };
            var historyProvider = new InMemoryChatHistoryProvider(new InMemoryChatHistoryProviderOptions
            {
                StateInitializer = _ => new InMemoryChatHistoryProvider.State
                {
                    Messages = LlmProviderChatClient.ToChatMessages(state.ChatMessages)
                }
            });
            var chatAgent = functionClient.AsAIAgent(new ChatClientAgentOptions
            {
                Name = "hetu-agent",
                ChatOptions = state.MafOptions,
                ChatHistoryProvider = historyProvider,
                UseProvidedChatClientAsIs = true,
            });
            AIAgent agent = state.Functions.Values.Any(function => function is ApprovalRequiredAIFunction)
                ? new ToolApprovalAgent(chatAgent, new ToolApprovalAgentOptions
                {
                    MaxAutoApprovalIterations = 10,
                    AutoApprovalRules =
                    [
                        async context => await ShouldAutoApproveAsync(state, context)
                    ]
                })
                : chatAgent;
            var session = await agent.CreateSessionAsync(ct);
            session.StateBag.SetValue("hetu.run-state", state);

            while (true)
            {
                state.BeginSegment();
                try
                {
                    await RunWithApprovalsAsync(
                        agent,
                        session,
                        Array.Empty<ChatMessage>(),
                        new ChatClientAgentRunOptions { ChatOptions = state.MafOptions },
                        state,
                        ct);
                }
                catch (AgentLoopStopException)
                {
                }

                if (state.Result.Cancelled || ct.IsCancellationRequested || state.Result.Error != null)
                    break;
                if (!state.EndedWithToolCalls || state.Stalled || state.ContextFull)
                    break;
                if (!state.SegmentProgress || state.Continuation >= state.MaxContinuations)
                    break;

                await ApplyContinuationAnchorAsync(state, ct);
                state.ReplaceMessages ??= state.LatestMessages.ToList();
                state.Continuation++;
                state.Result.ContinuationCount = state.Continuation;
                await sink.OnEventAsync(new
                {
                    type = "notice",
                    kind = "iteration_continue",
                    text = _localizer.T("agent.iterationContinue"),
                });
                state.PendingMessages.Add(new ChatMessage(ChatRole.User, _localizer.T("agent.iterationContinuePrompt")));
            }

            if (state.EndedWithToolCalls && !state.Result.Cancelled && state.Result.Error == null)
                await RunFinalWrapUpAsync(state, loopClient, ct);
        }
        catch (OperationCanceledException)
        {
            state.Result.Cancelled = true;
            _logger.LogInformation("[MAF] 用户中断 session={SessionId}", request.SessionId);
        }
        catch (Exception ex)
        {
            state.Result.Error = ex.Message;
            _logger.LogError(ex, "[MAF] 循环异常 session={SessionId}", request.SessionId);
            try { await sink.OnErrorAsync(ex.Message); } catch { }
        }

        return state.Result;
    }

    private async Task PrepareHistoryAsync(RunState state, CancellationToken ct)
    {
        var request = state.Request;
        state.ChatMessages = new List<LlmChatMessage>(request.Messages);
        state.HistoryCompressBoundary = Math.Max(0, state.ChatMessages.Count - 1);
        state.SessionTodos = new List<SessionTodo>();
        state.TurnId = Guid.NewGuid();
        state.TurnPreview = request.Messages.LastOrDefault(m => m.Role == "user")?.Content;

        if (!request.CompressHistory || state.ChatMessages.Count == 0) return;

        _logger.LogInformation("[Compression] {Pipeline}", await _compressionPipeline.DescribeAsync(ct));
        var beforeChars = state.ChatMessages.Sum(m => (long)(m.Content?.Length ?? 0));
        using var compressionGate = new SemaphoreSlim(MaxConcurrentCompressions, MaxConcurrentCompressions);
        var prepared = await Task.WhenAll(state.ChatMessages.Select(async message =>
        {
            await compressionGate.WaitAsync(ct);
            try { return await _compressionPipeline.PrepareForContextAsync(message.Content ?? string.Empty, ct); }
            finally { compressionGate.Release(); }
        }));
        var changedCount = 0;
        for (var i = 0; i < state.ChatMessages.Count; i++)
        {
            if (prepared[i] == (state.ChatMessages[i].Content ?? string.Empty)) continue;
            var message = state.ChatMessages[i];
            state.ChatMessages[i] = new LlmChatMessage
            {
                Role = message.Role,
                Content = prepared[i],
                ContentParts = message.ContentParts,
                ToolCallId = message.ToolCallId,
                ToolCalls = message.ToolCalls,
                ThinkingBlocks = message.ThinkingBlocks,
            };
            changedCount++;
        }
        var afterChars = state.ChatMessages.Sum(m => (long)(m.Content?.Length ?? 0));
        state.Result.FirstIterationInputChars = (int)beforeChars;
        state.Result.FirstIterationCompressedChars = (int)afterChars;
        _logger.LogInformation("[Compression] 入口压缩：{Count} 条消息 字符 {Before} → {After}（实际改写 {Changed} 条）",
            state.ChatMessages.Count, beforeChars, afterChars, changedCount);
    }

    private async Task BuildToolsAsync(RunState state)
    {
        var request = state.Request;
        var allToolNames = request.ToolNames.Concat(state.McpToolNames)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        state.CoreToolNames = request.CoreToolNames is { Count: > 0 }
            ? allToolNames.Where(name => state.McpToolNames.Contains(name, StringComparer.OrdinalIgnoreCase) ||
                                         request.CoreToolNames.Contains(name, StringComparer.OrdinalIgnoreCase)).ToList()
            : allToolNames;
        state.LoadableToolNames = allToolNames.Except(state.CoreToolNames, StringComparer.OrdinalIgnoreCase).ToList();
        state.LoadedToolNames = new List<string>();
        state.Functions = new Dictionary<string, AIFunction>(StringComparer.OrdinalIgnoreCase);

        foreach (var name in allToolNames)
        {
            var executor = _toolRegistry.GetExecutor(name);
            if (executor == null) continue;
            var function = new HetuToolFunction(
                executor.Name,
                _toolRegistry.Describe(executor),
                executor.ParametersSchema,
                (_, _) => ValueTask.FromException<object?>(new NotSupportedException("Tool invocation is routed through MAF FunctionInvoker.")));
            state.Functions[name] = InteractiveTools.IsInteractive(executor.Name) || !await RequiresApprovalAsync(state, executor.Name)
                ? function
                : new ApprovalRequiredAIFunction(function);
        }

        state.MafOptions = new MafChatOptions
        {
            Instructions = string.Empty,
            ToolMode = allToolNames.Count > 0 && request.EnableTools ? ChatToolMode.Auto : ChatToolMode.None,
            Temperature = request.Temperature is { } temperature ? (float?)temperature : null,
            MaxOutputTokens = request.MaxTokens,
            Reasoning = string.IsNullOrWhiteSpace(request.ReasoningEffort)
                ? null
                : new ReasoningOptions { Effort = ParseReasoningEffort(request.ReasoningEffort) },
            AdditionalProperties = new AdditionalPropertiesDictionary
            {
                ["ReasoningBudgetTokens"] = request.ReasoningBudgetTokens,
                ["Temperature"] = request.Temperature,
            },
        };
        RefreshTools(state);
    }

    private void RefreshTools(RunState state)
    {
        var declared = state.CoreToolNames.Concat(state.LoadedToolNames)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(state.Functions.ContainsKey)
            .ToList();
        state.MafOptions.Tools = state.Request.EnableTools
            ? declared.Select(name => state.Functions[name]).Cast<AITool>().ToList()
            : new List<AITool>();
        state.MafOptions.Instructions = ComposeSystemPrompt(
            state.Request.SystemPrompt,
            declared.Count,
            state.LoadableToolNames.Except(state.LoadedToolNames, StringComparer.OrdinalIgnoreCase).ToList(),
            state.Request.MaxToolCallsPerTurn);
    }

    private async Task<(bool Allowed, ToolApprovalMode Mode)> EvaluateApprovalAsync(RunState state, string toolName, string arguments)
    {
        var call = new LlmToolCall { Id = "approval-probe", Name = toolName, Arguments = arguments };
        var executor = _toolRegistry.GetExecutor(toolName);
        var explicitOverride = state.Request.ToolApprovals.TryGetValue(toolName, out var byName)
            ? byName
            : state.Request.ToolApprovals.TryGetValue("*", out var byWildcard)
                ? byWildcard
                : (ToolApprovalMode?)null;
        var approval = explicitOverride ?? executor?.DefaultApproval ?? ToolApprovalMode.Auto;
        if (state.Request.DecideToolCall == null)
            return (true, approval);
        var decision = await state.Request.DecideToolCall(call, approval);
        return (decision.Allowed, explicitOverride ?? decision.Mode);
    }

    private async Task<bool> RequiresApprovalAsync(RunState state, string toolName)
    {
        var (allowed, mode) = await EvaluateApprovalAsync(state, toolName, "{}");
        return allowed && mode == ToolApprovalMode.Ask;
    }

    private async Task<bool> ShouldAutoApproveAsync(RunState state, ToolAutoApprovalRuleContext context)
    {
        if (context.FunctionCallContent is not FunctionCallContent functionCall)
            return true;
        var (allowed, mode) = await EvaluateApprovalAsync(
            state,
            functionCall.Name,
            JsonSerializer.Serialize(functionCall.Arguments));
        return !allowed || mode != ToolApprovalMode.Ask;
    }

    private async Task RunWithApprovalsAsync(
        AIAgent agent,
        AgentSession session,
        IReadOnlyList<ChatMessage> messages,
        ChatClientAgentRunOptions options,
        RunState state,
        CancellationToken ct)
    {
        var stream = messages.Count == 0
            ? agent.RunStreamingAsync(session, options, ct)
            : agent.RunStreamingAsync(messages, session, options, ct);
        await foreach (var update in stream)
        {
            foreach (var content in update.Contents)
            {
                if (content is not ToolApprovalRequestContent request)
                {
                    await ProcessUpdateAsync(state, [content]);
                    continue;
                }

                var functionCall = request.ToolCall as FunctionCallContent;
                var callId = functionCall?.CallId ?? request.RequestId;
                var name = functionCall?.Name ?? request.RequestId;
                var arguments = functionCall != null ? JsonSerializer.Serialize(functionCall.Arguments) : "{}";
                var pending = _toolExecution.RegisterApproval(state.Request.SessionId, callId);
                await state.Sink.OnEventAsync(new
                {
                    type = "approval_request",
                    id = callId,
                    name,
                    arguments,
                });
                bool approved;
                try
                {
                    approved = await pending.Task.WaitAsync(TimeSpan.FromMinutes(5), ct);
                }
                catch (TimeoutException)
                {
                    approved = false;
                }
                finally
                {
                    _toolExecution.RemoveApproval(state.Request.SessionId, callId);
                }

                var response = request.CreateResponse(approved, approved ? null : "rejected");
                await RunWithApprovalsAsync(
                    agent,
                    session,
                    [new ChatMessage(ChatRole.User, [response])],
                    options,
                    state,
                    ct);
                return;
            }
        }
    }

    private async ValueTask<object?> InvokeToolAsync(
        RunState state,
        FunctionInvocationContext context,
        CancellationToken cancellationToken)
    {
        var request = state.Request;
        var toolName = context.Function.Name;
        var callId = context.CallContent.CallId;
        var argumentsJson = JsonSerializer.Serialize(context.Arguments.ToDictionary(pair => pair.Key, pair => pair.Value));
        var call = new LlmToolCall { Id = callId, Name = toolName, Arguments = argumentsJson };
        RecordToolCall(state, context.Iteration, call);
        var maxToolCalls = request.MaxToolCallsPerTurn > 0 ? request.MaxToolCallsPerTurn : DefaultMaxToolCallsPerTurn;
        state.CurrentIterationToolCalls = Math.Max(state.CurrentIterationToolCalls, context.FunctionCallIndex + 1);

        if (context.FunctionCallIndex >= maxToolCalls)
        {
            var dropped = _localizer.T("toolExec.tooManyCallsDropped", maxToolCalls);
            await state.Sink.OnEventAsync(new
            {
                type = "tool_result",
                id = callId,
                name = toolName,
                content = dropped,
                isError = true,
                hidden = true,
            });
            RecordToolResult(state, callId, dropped);
            return dropped;
        }

        var key = CallKey(call);
        if (state.ReadResultCache.TryGetValue(key, out var cached))
        {
            var reused = _localizer.T("toolExec.reusedResult", toolName, cached);
            await EmitHiddenToolResultAsync(state, call, reused, false);
            RecordToolResult(state, callId, reused);
            return reused;
        }
        if (state.FailureCounts.TryGetValue(key, out var failures) && failures >= 2)
        {
            var repeated = _localizer.T("toolExec.repeatedFailure", toolName);
            await EmitHiddenToolResultAsync(state, call, repeated, true);
            RecordToolResult(state, callId, repeated);
            return repeated;
        }

        state.CurrentIterationExecutableCalls++;
        await (state.Hooks?.BeforeToolCallsAsync([call]) ?? Task.CompletedTask);
        var approvalOverrides = new Dictionary<string, ToolApprovalMode>(request.ToolApprovals);
        if (context.Function is ApprovalRequiredAIFunction)
            approvalOverrides[toolName] = ToolApprovalMode.Bypass;
        var results = await _toolExecution.ExecuteToolCallsAsync(
            request.SessionId,
            [call],
            approvalOverrides,
            state.SessionTodos,
            data => state.Sink.OnEventAsync(data),
            payload => state.Sink.OnEventAsync(payload),
            cancellationToken,
            decideToolCall: request.DecideToolCall,
            workScope: request.WorkScope,
            questionHandler: request.QuestionHandler,
            planHandler: request.PlanHandler,
            defaultToolTimeout: request.ToolTimeout);
        var (_, content, isError) = results[0];
        isError |= content.StartsWith("Error:", StringComparison.OrdinalIgnoreCase);
        var compacted = CompactToolResult(
            await _compressionPipeline.PrepareForContextAsync(content, cancellationToken),
            isError ? MaxToolErrorCharsForModel : MaxToolResultCharsForModel);
        RecordToolResult(state, callId, compacted);

        await state.Sink.OnToolCallAsync(call);
        state.Result.ToolCalls.Add(new AgentToolCallRecord
        {
            Id = callId,
            Name = toolName,
            Arguments = argumentsJson,
            Result = content,
            IsError = isError,
        });
        state.Result.Timeline.Add(new AgentTimelineSegment
        {
            Kind = "tool",
            Name = toolName,
            Arguments = argumentsJson,
            Result = content,
            IsError = isError,
        });
        await state.Sink.OnToolResultAsync(callId, content, isError);

        var execution = new AgentToolExecution { Call = call, Result = content, IsError = isError };
        if (state.Hooks != null)
        {
            await state.Hooks.AfterToolResultAsync(execution);
            await state.Hooks.AfterToolResultsAsync([execution]);
        }

        if (isError)
        {
            state.FailureCounts[key] = state.FailureCounts.GetValueOrDefault(key) + 1;
        }
        else
        {
            state.SegmentProgress = true;
            state.FailureCounts.Remove(key);
            if (_toolRegistry.GetExecutor(toolName)?.Risk == ToolRisk.Read)
                state.ReadResultCache[key] = content;
        }

        if (string.Equals(toolName, "load_tools", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var loaded in ParseLoadedToolNames(argumentsJson))
            {
                if (state.LoadableToolNames.Contains(loaded, StringComparer.OrdinalIgnoreCase) &&
                    !state.LoadedToolNames.Contains(loaded, StringComparer.OrdinalIgnoreCase))
                {
                    state.LoadedToolNames.Add(loaded);
                }
            }
            RefreshTools(state);
        }

        return compacted;
    }

    private async Task OnRequestCompletedAsync(
        RunState state,
        LlmUsage? usage,
        long elapsedMs,
        string? finishReason,
        string contentPreview,
        int toolCallCount,
        int inputEstimate)
    {
        var request = state.Request;
        state.TotalIterations++;
        state.Result.Iterations = state.TotalIterations;
        AccumulateUsage(state.Result.Usage, usage);
        if (usage != null) await state.Sink.OnUsageAsync(state.Result.Usage);

        var iterContent = state.CurrentContent.ToString();
        var iterThinking = state.CurrentThinking.ToString();
        if (iterThinking.Length > 0)
            state.Result.Timeline.Add(new AgentTimelineSegment { Kind = "thought", Content = iterThinking });
        if (iterContent.Length > 0)
            state.Result.Timeline.Add(new AgentTimelineSegment { Kind = "text", Content = iterContent });
        await (state.Hooks?.OnIterationAsync(state.TotalIterations - 1, iterContent, iterThinking, usage) ?? Task.CompletedTask);

        var first = state.TotalIterations == 1;
        var recordedInput = first && state.Result.FirstIterationInputChars > 0
            ? LlmTokenEstimator.EstimateChars(state.Result.FirstIterationInputChars)
            : inputEstimate;
        int? compressed = first
            ? state.Result.FirstIterationCompressedChars > 0
                ? LlmTokenEstimator.EstimateChars(state.Result.FirstIterationCompressedChars)
                : inputEstimate
            : null;
        await _usageRecorder.RecordAsync(
            request.UsageSource,
            usage,
            refId: request.UsageRefId,
            modelId: request.ModelId,
            inputTokens: recordedInput,
            compressedTokens: compressed,
            latencyMs: (int)elapsedMs,
            contentPreview: first ? state.TurnPreview : contentPreview,
            turnId: state.TurnId,
            iteration: state.TotalIterations,
            requestKind: request.UsageRequestKind,
            finishReason: finishReason,
            toolCallCount: toolCallCount,
            ct: CancellationToken.None);

        if (finishReason == "invalid_tool_call")
        {
            state.Result.Error = _localizer.T("toolExec.invalidArguments", "tool_call");
            await state.Sink.OnErrorAsync(state.Result.Error);
        }
        else if (finishReason is "length" or "max_tokens")
        {
            state.Result.Error = _localizer.T("toolExec.truncated");
            await state.Sink.OnErrorAsync(state.Result.Error);
        }

        state.EndedWithToolCalls = toolCallCount > 0;
        state.CurrentIterationToolCalls = toolCallCount;
        state.CurrentIterationExecutableCalls = 0;
    }

    private static async Task ProcessUpdateAsync(RunState state, IEnumerable<AIContent> contents)
    {
        foreach (var content in contents)
        {
            switch (content)
            {
                case TextContent text:
                    state.CurrentContent.Append(text.Text);
                    state.Result.Content += text.Text;
                    await state.Sink.OnContentAsync(text.Text);
                    break;
                case TextReasoningContent reasoning:
                    state.CurrentThinking.Append(reasoning.Text);
                    state.Result.Thinking += reasoning.Text;
                    await state.Sink.OnThinkingAsync(reasoning.Text);
                    break;
            }
        }
    }

    private async Task ApplyContinuationAnchorAsync(RunState state, CancellationToken ct)
    {
        var history = state.LatestMessages.ToList();
        var activeStart = state.HistoryCompressBoundary + 1;
        var activeMessages = history.Skip(activeStart).ToList();
        var activeChars = activeMessages.Sum(MessageChars);
        if (activeChars <= state.AnchorChars) return;

        var summary = await _contextCompaction.SummarizeTurnAsync(
            activeMessages.Select(LlmProviderChatClient.ToLlmMessage).ToList(),
            state.Request.ModelId,
            ct) ?? BuildAlgorithmicHandoff(activeMessages.Select(LlmProviderChatClient.ToLlmMessage).ToList());
        var handoff = $"【进展交接】\n{summary}";
        history.RemoveRange(activeStart, history.Count - activeStart);
        history.Add(new ChatMessage(ChatRole.User, handoff));
        state.ReplaceMessages = history;
        state.PreviousRequestContents = null;
        _logger.LogInformation("[MAF] 续跑锚点：当前轮 {Before} 字符压成交接摘要 {After} 字符", activeChars, handoff.Length);
        await state.Sink.OnEventAsync(new
        {
            type = "notice",
            kind = "context_anchor",
            text = _localizer.T("agent.contextAnchorNotice"),
        });
    }

    private async Task RunFinalWrapUpAsync(RunState state, LoopChatClient loopClient, CancellationToken ct)
    {
        if (!state.Stalled && !state.ContextFull) state.Result.IterationLimitReached = true;
        var noticeKey = state.ContextFull ? "agent.contextFullNotice"
            : state.Stalled ? "agent.stalledNotice"
            : "agent.iterationLimitNotice";
        var promptKey = state.ContextFull ? "agent.contextFullPrompt"
            : state.Stalled ? "agent.stalledPrompt"
            : "agent.iterationLimitPrompt";
        var noticeKind = state.ContextFull ? "context_full"
            : state.Stalled ? "agent_stalled"
            : "iteration_limit";
        var notice = _localizer.T(noticeKey);
        await state.Sink.OnEventAsync(new { type = "notice", kind = noticeKind, text = notice });
        var history = state.LatestMessages.ToList();
        history.Add(new ChatMessage(ChatRole.User, _localizer.T(promptKey)));
        state.MafOptions.Tools = null;
        state.MafOptions.ToolMode = ChatToolMode.None;
        state.Finalizing = true;
        var finalOptions = state.MafOptions.Clone();
        finalOptions.Tools = null;
        finalOptions.ToolMode = ChatToolMode.None;

        await foreach (var update in loopClient.GetStreamingResponseAsync(history, finalOptions, ct))
        {
            await ProcessUpdateAsync(state, update.Contents);
        }

        if (string.IsNullOrWhiteSpace(state.CurrentContent.ToString()) && !state.Result.Cancelled)
        {
            await state.Sink.OnContentAsync(notice);
            state.Result.Content += notice;
        }
    }

    private static long MessageChars(ChatMessage message)
        => message.Text.Length + message.Contents.Sum(content => content switch
        {
            FunctionResultContent result => result.Result?.ToString()?.Length ?? 0,
            FunctionCallContent call => call.Arguments?.Values.Sum(value => value?.ToString()?.Length ?? 0) ?? 0,
            _ => 0,
        });

    private static void RecordToolCall(RunState state, int iteration, LlmToolCall call)
    {
        if (state.HistoryIteration != iteration)
        {
            state.HistoryIteration = iteration;
            state.LatestMessages.Add(new ChatMessage(ChatRole.Assistant, []));
        }
        var assistant = state.LatestMessages.LastOrDefault(message => message.Role == ChatRole.Assistant);
        assistant?.Contents.Add(new FunctionCallContent(
            call.Id,
            call.Name,
            JsonSerializer.Deserialize<Dictionary<string, object?>>(call.Arguments)
            ?? new Dictionary<string, object?>()));
    }

    private static void RecordToolResult(RunState state, string callId, string content)
        => state.LatestMessages.Add(new ChatMessage(ChatRole.Tool, [new FunctionResultContent(callId, content)]));

    private static async Task EmitHiddenToolResultAsync(RunState state, LlmToolCall call, string content, bool isError)
        => await state.Sink.OnEventAsync(new
        {
            type = "tool_result",
            id = call.Id,
            name = call.Name,
            content,
            isError,
            hidden = true,
        });

    private static string CallKey(LlmToolCall call) => call.Name + "\u0000" + call.Arguments;

    private static void AccumulateUsage(LlmUsage total, LlmUsage? delta)
    {
        if (delta == null) return;
        total.PromptTokens += delta.PromptTokens;
        total.CompletionTokens += delta.CompletionTokens;
        total.TotalTokens += delta.TotalTokens;
        total.CachedTokens += delta.CachedTokens;
    }

    private static string CompactToolResult(string content, int targetChars)
    {
        if (content.Length <= targetChars) return content;
        var headLength = Math.Max(1, targetChars * 2 / 3);
        var tailLength = Math.Max(1, targetChars - headLength);
        return $"[tool-output-compacted original_chars={content.Length}]\n{content[..headLength]}\n...\n{content[^tailLength..]}";
    }

    private static string BuildAlgorithmicHandoff(List<LlmChatMessage> messages)
    {
        var sb = new StringBuilder();
        foreach (var message in messages)
        {
            var content = message.Content ?? string.Empty;
            if (content.Length == 0) continue;
            var excerpt = content.Length <= 600 ? content : content[..400] + "\n...\n" + content[^200..];
            sb.Append(message.Role == "user" ? "用户: " : message.Role == "tool" ? "工具: " : "助手: ");
            sb.AppendLine(excerpt);
        }
        var text = sb.ToString();
        return text.Length <= 20_000 ? text : text[^20_000..];
    }

    private static string ComposeSystemPrompt(string agentPrompt, int declaredCount, List<string> loadableToolNames, int maxToolCallsPerTurn)
    {
        var sb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(agentPrompt)) sb.AppendLine(agentPrompt.Trim());
        if (declaredCount <= 0 && loadableToolNames.Count <= 0) return sb.ToString().TrimEnd();

        sb.AppendLine();
        sb.AppendLine("# 工具使用约定");
        sb.AppendLine($"- 单轮回复内工具调用尽量不超过 {maxToolCallsPerTurn} 次；能直接回答的问题不要无脑调用工具");
        sb.AppendLine("- 工具调用失败最多重试 1 次，仍失败则切换策略或如实告知");
        sb.AppendLine("- 不要在正文中自述「调用了哪个工具」，直接给结果");
        sb.AppendLine($"- 已声明 {declaredCount} 个工具，可直接调用（说明与参数见函数定义）");
        if (loadableToolNames.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine($"以下 {loadableToolNames.Count} 个工具未随请求声明，需要时先用 load_tools 加载参数说明（names 传工具名或分组名，也可用 query 按关键词搜），再直接调用：");
            foreach (var group in ToolGroupMap.Order)
            {
                var names = loadableToolNames.Where(name => ToolGroupMap.Resolve(name) == group).ToList();
                if (names.Count > 0) sb.AppendLine($"- {group}: {string.Join("、", names)}");
            }
        }
        return sb.ToString().TrimEnd();
    }

    private static List<string> ParseLoadedToolNames(string argumentsJson)
    {
        var names = new List<string>();
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            if (doc.RootElement.TryGetProperty("names", out var array) && array.ValueKind == JsonValueKind.Array)
            {
                names.AddRange(array.EnumerateArray()
                    .Where(element => element.ValueKind == JsonValueKind.String)
                    .Select(element => element.GetString() ?? string.Empty)
                    .Where(name => name.Length > 0));
            }
            else if (doc.RootElement.TryGetProperty("name", out var single) && single.ValueKind == JsonValueKind.String)
            {
                names.Add(single.GetString() ?? string.Empty);
            }
        }
        catch (JsonException)
        {
        }
        return names;
    }

    private static ReasoningEffort ParseReasoningEffort(string value) => value.Trim().ToLowerInvariant() switch
    {
        "none" => ReasoningEffort.None,
        "minimal" => ReasoningEffort.Low,
        "low" => ReasoningEffort.Low,
        "medium" => ReasoningEffort.Medium,
        "high" => ReasoningEffort.High,
        "xhigh" or "max" => ReasoningEffort.ExtraHigh,
        _ => ReasoningEffort.Medium,
    };

    private sealed class RunState
    {
        public AgentLoopRequest Request { get; }
        public IReadOnlyList<string> McpToolNames { get; }
        public IAgentLoopSink Sink { get; set; } = new NullAgentLoopSink();
        public IAgentLoopHooks? Hooks { get; set; }
        public AgentLoopResult Result { get; set; } = new();
        public List<LlmChatMessage> ChatMessages { get; set; } = new();
        public int HistoryCompressBoundary { get; set; }
        public List<SessionTodo> SessionTodos { get; set; } = new();
        public Guid TurnId { get; set; }
        public string? TurnPreview { get; set; }
        public List<string> CoreToolNames { get; set; } = new();
        public List<string> LoadableToolNames { get; set; } = new();
        public List<string> LoadedToolNames { get; set; } = new();
        public Dictionary<string, AIFunction> Functions { get; set; } = new(StringComparer.OrdinalIgnoreCase);
        public MafChatOptions MafOptions { get; set; } = new();
        public int MaxIterations { get; init; }
        public int MaxContinuations { get; init; }
        public int Continuation { get; set; }
        public long HardCapChars { get; init; }
        public long AnchorChars { get; init; }
        public int TotalIterations { get; set; }
        public bool EndedWithToolCalls { get; set; }
        public bool SegmentProgress { get; set; }
        public bool Stalled { get; set; }
        public bool ContextFull { get; set; }
        public bool Finalizing { get; set; }
        public int StalledIterations { get; set; }
        public int CurrentIterationToolCalls { get; set; }
        public int CurrentIterationExecutableCalls { get; set; }
        public int SegmentModelRequests { get; set; }
        public StringBuilder CurrentContent { get; } = new();
        public StringBuilder CurrentThinking { get; } = new();
        public Dictionary<string, string> ReadResultCache { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, int> FailureCounts { get; } = new(StringComparer.Ordinal);
        public List<string>? PreviousRequestContents { get; set; }
        public List<ChatMessage> LatestMessages { get; set; } = new();
        public List<ChatMessage> PendingMessages { get; } = new();
        public List<ChatMessage>? ReplaceMessages { get; set; }
        public int HistoryIteration { get; set; } = -1;

        public RunState(AgentLoopRequest request, IReadOnlyList<string> mcpToolNames)
        {
            Request = request;
            McpToolNames = mcpToolNames;
            MaxIterations = request.MaxIterations > 0 ? request.MaxIterations : DefaultMaxIterations;
            MaxContinuations = Math.Max(0, request.MaxContinuations);
            var windowTokens = request.ContextWindowTokens is > 0 ? request.ContextWindowTokens.Value : DefaultContextWindowTokens;
            var windowChars = (long)windowTokens * LlmTokenEstimator.CharsPerToken;
            HardCapChars = windowChars * HardCapPercent / 100;
            AnchorChars = windowChars * AnchorPercent / 100;
        }

        public void BeginSegment()
        {
            EndedWithToolCalls = false;
            SegmentProgress = false;
            CurrentContent.Clear();
            CurrentThinking.Clear();
            CurrentIterationToolCalls = 0;
            CurrentIterationExecutableCalls = 0;
            SegmentModelRequests = 0;
            HistoryIteration = -1;
        }
    }

    private sealed class LoopChatClient : IChatClient
    {
        private readonly RunState _state;
        private readonly IChatClient _inner;

        public LoopChatClient(RunState state, IChatClient inner)
        {
            _state = state;
            _inner = inner;
        }

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            MafChatOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            return _inner.GetResponseAsync(BeforeRequest(messages), options, cancellationToken);
        }

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            MafChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var prepared = BeforeRequest(messages);
            await foreach (var update in _inner.GetStreamingResponseAsync(prepared, options, cancellationToken))
                yield return update;
        }

        private List<ChatMessage> BeforeRequest(IEnumerable<ChatMessage> messages)
        {
            if (_state.Finalizing) return messages.ToList();
            if (_state.SegmentModelRequests >= _state.MaxIterations)
                throw new AgentLoopStopException();
            _state.SegmentModelRequests++;

            var list = messages.ToList();
            if (_state.ReplaceMessages is { } replacement)
            {
                list.Clear();
                list.AddRange(replacement);
                _state.ReplaceMessages = null;
            }
            list.AddRange(_state.PendingMessages);
            _state.PendingMessages.Clear();

            if (_state.Request.DrainSteering != null)
            {
                foreach (var guidance in _state.Request.DrainSteering())
                {
                    list.Add(new ChatMessage(ChatRole.User, $"{SteeringPrefix}{guidance}"));
                    _state.Sink.OnSteeringAsync(guidance).GetAwaiter().GetResult();
                }
            }
            _state.LatestMessages = list.ToList();

            if (_state.CurrentIterationToolCalls > 0)
            {
                _state.StalledIterations = _state.CurrentIterationExecutableCalls == 0
                    ? _state.StalledIterations + 1
                    : 0;
                if (_state.StalledIterations >= MaxStalledIterations)
                {
                    _state.Stalled = true;
                    throw new AgentLoopStopException();
                }
            }

            var totalChars = list.Sum(message => (long)message.Text.Length);
            if (totalChars > _state.HardCapChars)
            {
                _state.ContextFull = true;
                throw new AgentLoopStopException();
            }

            var current = list.Select(message => message.Text).ToList();
            if (_state.PreviousRequestContents != null)
            {
                var stable = 0;
                var max = Math.Min(_state.PreviousRequestContents.Count, current.Count);
                while (stable < max && string.Equals(_state.PreviousRequestContents[stable], current[stable], StringComparison.Ordinal)) stable++;
                if (stable < _state.PreviousRequestContents.Count)
                {
                    // MAF owns append-only history; this branch is diagnostic only.
                }
            }
            _state.PreviousRequestContents = current;
            _state.CurrentContent.Clear();
            _state.CurrentThinking.Clear();
            return list;
        }

        public object? GetService(Type serviceType, object? serviceKey = null) => _inner.GetService(serviceType, serviceKey);
        public void Dispose() => _inner.Dispose();
    }

    private sealed class HetuToolFunction : AIFunction
    {
        private readonly Func<AIFunctionArguments, CancellationToken, ValueTask<object?>> _invoker;

        public HetuToolFunction(
            string name,
            string description,
            JsonElement jsonSchema,
            Func<AIFunctionArguments, CancellationToken, ValueTask<object?>> invoker)
        {
            Name = name;
            Description = description;
            JsonSchema = jsonSchema;
            _invoker = invoker;
        }

        public override string Name { get; }
        public override string Description { get; }
        public override JsonElement JsonSchema { get; }

        protected override async ValueTask<object?> InvokeCoreAsync(AIFunctionArguments? arguments = null, CancellationToken cancellationToken = default)
            => await _invoker(arguments ?? new AIFunctionArguments(), cancellationToken);
    }

    private sealed class AgentLoopStopException : Exception
    {
    }

    private sealed class NullAgentLoopSink : IAgentLoopSink
    {
    }
}
