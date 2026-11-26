using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Client;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Agents;

/// <summary>
/// Hetu 的 Agent 宿主。模型调用、工具循环、审批暂停/恢复全部交给 MAF：
/// <see cref="FunctionInvokingChatClient"/> 负责工具循环，<see cref="ToolApprovalAgent"/> 负责审批规则，
/// 这里只做产品级的事件转发、历史压缩和结果汇总。
/// </summary>
internal sealed class HetuAgentRunner : IAgentRunner
{
    private const int DefaultMaxIterations = 15;

    private readonly IAgentFactory _agentFactory;
    private readonly ToolRegistry _toolRegistry;
    private readonly ToolExecutionService _toolExecution;
    private readonly CompressionPipelineService _compression;
    private readonly McpClientProvider _mcpClients;
    private readonly ILocalizer _localizer;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<HetuAgentRunner> _logger;

    public HetuAgentRunner(
        IAgentFactory agentFactory,
        ToolRegistry toolRegistry,
        ToolExecutionService toolExecution,
        CompressionPipelineService compression,
        McpClientProvider mcpClients,
        ILocalizer localizer,
        IUnitOfWork unitOfWork,
        ILogger<HetuAgentRunner> logger)
    {
        _agentFactory = agentFactory;
        _toolRegistry = toolRegistry;
        _toolExecution = toolExecution;
        _compression = compression;
        _mcpClients = mcpClients;
        _localizer = localizer;
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task<AgentModelInfo?> ResolveModelAsync(string? requestedModelId, Guid? fallbackModelId, CancellationToken ct)
    {
        Guid? id = Guid.TryParse(requestedModelId, out var requested) ? requested : fallbackModelId;
        var resolved = await _agentFactory.ResolveAsync(id, ct);
        return resolved == null
            ? null
            : new AgentModelInfo(resolved.Model.Id, resolved.ProviderType, resolved.Model.SupportsVision);
    }

    public async Task<IReadOnlyList<AIFunction>> LoadMcpToolsAsync(List<Guid> mcpServerIds, CancellationToken ct)
    {
        var functions = new List<AIFunction>();
        if (mcpServerIds is null || mcpServerIds.Count == 0) return functions;

        var servers = (await _unitOfWork.McpServers.FindAsync(s => mcpServerIds.Contains(s.Id), ct))
            .ToDictionary(s => s.Id);
        foreach (var serverId in mcpServerIds)
        {
            var server = servers.GetValueOrDefault(serverId);
            if (server == null || !server.IsEnabled)
            {
                _logger.LogWarning("跳过 MCP 服务器 {ServerId}：不存在/已禁用", serverId);
                continue;
            }

            try
            {
                var client = await _mcpClients.GetAsync(server.ConnectionConfig, ct);
                var tools = await client.ListToolsAsync(cancellationToken: ct);
                functions.AddRange(tools.Select(tool => (AIFunction)tool.WithName(BuildMcpToolName(server.Name, tool.Name))));
                _logger.LogInformation("从 MCP 服务器 {ServerName} 加载 {Count} 个工具", server.Name, tools.Count);
            }
            catch (Exception ex)
            {
                _mcpClients.Invalidate(server.ConnectionConfig);
                _logger.LogError(ex, "加载 MCP 服务器 {ServerName} 工具失败", server.Name);
            }
        }
        return functions;
    }

    public async Task<AgentLoopResult> RunAsync(AgentLoopRequest request, CancellationToken ct)
    {
        var resolved = await _agentFactory.ResolveAsync(request.ModelId, ct)
                       ?? throw new InvalidOperationException(_localizer.T("model.noModelConfigured"));
        request.ModelId ??= resolved.Model.Id;
        var mcpTools = request.RuntimeFunctions ?? await LoadMcpToolsAsync(request.McpServerIds, ct);
        var state = new AgentRunState(request);
        state.Result.ModelId = resolved.Model.Id.ToString();

        try
        {
            PrepareHistory(state);
            BuildTools(state, mcpTools);

            var (history, inputMessages) = SplitHistoryMessages(state.ChatMessages);
            var inputChars = inputMessages.Sum(message => message.Content?.Length ?? 0);
            var options = BuildAgentOptions(state, resolved, history, inputChars);
            var agent = _agentFactory.Create(resolved, options, state, request.MaxIterations > 0 ? request.MaxIterations : DefaultMaxIterations);

            if (state.Functions.Values.OfType<ApprovalRequiredAIFunction>().Any())
            {
                agent = new ToolApprovalAgent(agent, new ToolApprovalAgentOptions
                {
                    MaxAutoApprovalIterations = 50,
                    AutoApprovalRules = [async context => await ShouldAutoApproveAsync(state, context)],
                });
            }

            var session = await agent.CreateSessionAsync(ct);
            var runOptions = new ChatClientAgentRunOptions();
            var input = AgentMessageMapper.ToChatMessages(inputMessages);

            while (true)
            {
                var approvals = new List<ToolApprovalRequestContent>();
                await foreach (var update in agent.RunStreamingAsync(input, session, runOptions, ct))
                {
                    foreach (var content in update.Contents)
                    {
                        switch (content)
                        {
                            case TextContent text:
                                await state.AppendTextAsync(text.Text);
                                break;
                            case TextReasoningContent thinking:
                                await state.AppendThinkingAsync(thinking.Text);
                                break;
                            case ToolApprovalRequestContent approval:
                                approvals.Add(approval);
                                break;
                            case FunctionCallContent call:
                                state.ApprovalToolNames[call.CallId] = call.Name;
                                state.ToolCallArguments[call.CallId] = JsonSerializer.Serialize(call.Arguments);
                                break;
                            case FunctionResultContent result when !state.RecordedToolCallIds.Contains(result.CallId):
                                {
                                    // 审批被拒绝或原生 MCP 工具等未进入 HetuAIFunction 的结果，由 MAF 直接生成；
                                    // 补 tool_call/tool_result，避免前端卡片悬挂或缺参数。
                                    var resultText = AgentMessageMapper.ConvertResult(result.Result);
                                    var name = state.ApprovalToolNames.GetValueOrDefault(result.CallId) ?? "tool";
                                    var arguments = state.ToolCallArguments.GetValueOrDefault(result.CallId) ?? "{}";
                                    var isError = result.Exception is not null;
                                    state.AppendToolCall(new AgentToolCallRecord
                                    {
                                        Id = result.CallId,
                                        Name = name,
                                        Arguments = arguments,
                                        Result = resultText,
                                        IsError = isError,
                                    });
                                    await state.Sink.OnEventAsync(new
                                    {
                                        type = "tool_call",
                                        id = result.CallId,
                                        name,
                                        arguments,
                                    });
                                    await state.Sink.OnEventAsync(new
                                    {
                                        type = "tool_result",
                                        id = result.CallId,
                                        name,
                                        content = resultText,
                                        isError,
                                    });
                                    await state.Sink.OnToolCallAsync(new LlmToolCall { Id = result.CallId, Name = name, Arguments = arguments });
                                    await state.Sink.OnToolResultAsync(result.CallId, resultText, isError);
                                    break;
                                }
                        }
                    }
                }

                if (approvals.Count == 0) break;

                var responses = new List<AIContent>();
                foreach (var approval in approvals)
                {
                    var response = await RequestApprovalAsync(state, approval, ct);
                    responses.Add(response);
                }
                input = [new ChatMessage(ChatRole.User, responses)];
            }

            if (string.IsNullOrWhiteSpace(state.Result.Content) && state.Result.ToolCalls.Count > 0)
                state.Result.Content = _localizer.T("chat.noOutputWithTools", string.Join("、", state.Result.ToolCalls.Select(t => t.Name).Distinct()));
            if (state.IterationCount >= (request.MaxIterations > 0 ? request.MaxIterations : DefaultMaxIterations)
                && state.Result.ToolCalls.Count > 0)
                state.Result.IterationLimitReached = true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            state.Result.Cancelled = true;
            _logger.LogInformation("[Agent] 用户中断 session={SessionId}", request.SessionId);
        }
        catch (Exception ex)
        {
            state.Result.Error = ex.Message;
            _logger.LogError(ex, "[Agent] 运行异常 session={SessionId}", request.SessionId);
            try { await state.Sink.OnErrorAsync(ex.Message); } catch { }
        }

        return state.Result;
    }

    private static void PrepareHistory(AgentRunState state)
    {
        state.ChatMessages = new List<LlmChatMessage>(state.Request.Messages);
    }

    private void BuildTools(AgentRunState state, IReadOnlyList<AIFunction> runtimeFunctions)
    {
        var request = state.Request;
        var runtimeByName = runtimeFunctions.ToDictionary(function => function.Name, StringComparer.OrdinalIgnoreCase);
        var allNames = request.ToolNames.Concat(runtimeByName.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        state.CoreToolNames = request.CoreToolNames is { Count: > 0 }
            ? allNames.Where(name => runtimeByName.ContainsKey(name)
                                     || request.CoreToolNames.Contains(name, StringComparer.OrdinalIgnoreCase))
                .ToList()
            : allNames;
        state.LoadableToolNames = allNames.Except(state.CoreToolNames, StringComparer.OrdinalIgnoreCase).ToList();

        if (!request.EnableTools)
        {
            state.CoreToolNames.Clear();
            state.LoadableToolNames.Clear();
            return;
        }

        foreach (var name in allNames)
        {
            AIFunction? function = null;
            var interactive = false;

            if (runtimeByName.TryGetValue(name, out var runtimeFunction))
            {
                function = runtimeFunction;
            }
            else
            {
                var executor = _toolRegistry.GetExecutor(name);
                if (executor == null) continue;

                var description = _toolRegistry.Describe(executor);
                var guideline = _toolRegistry.Guideline(executor);
                if (!string.IsNullOrWhiteSpace(guideline)) description = $"{description}｜{guideline}";
                var schemaText = _toolRegistry.LocalizeParameters(executor.Name, executor.ParametersSchema.GetRawText())
                                 ?? executor.ParametersSchema.GetRawText();
                using var schemaDoc = JsonDocument.Parse(schemaText);
                function = new HetuAIFunction(
                    executor, _toolExecution, _compression, _localizer, state, _logger,
                    description, schemaDoc.RootElement.Clone());
                interactive = InteractiveTools.IsInteractive(executor.Name);
            }

            // 交互工具自己等待用户输入；其余工具（含 MCP）都交给 MAF 审批管道。
            if (!interactive)
                function = new ApprovalRequiredAIFunction(function);

            state.Functions[name] = function;
        }
    }

    private static string BuildMcpToolName(string serverName, string toolName)
        => $"mcp_{Sanitize(serverName)}_{Sanitize(toolName)}";

    private static string Sanitize(string input)
        => string.Concat(input.Where(c => char.IsLetterOrDigit(c) || c is '_' or '-'));

    private static (IReadOnlyList<LlmChatMessage> History, IReadOnlyList<LlmChatMessage> Input) SplitHistoryMessages(
        IReadOnlyList<LlmChatMessage> messages)
    {
        if (messages.Count <= 1) return ([], messages);

        // 本轮输入从最后一条 user 消息开始；之前的消息交给 MAF ChatHistoryProvider，
        // 避免每轮把完整历史当成本次输入重复传递。
        var start = messages.Count - 1;
        while (start > 0 && messages[start].Role != "user") start--;
        return (messages.Take(start).ToList(), messages.Skip(start).ToList());
    }

    private ChatHistoryProvider CreateChatHistoryProvider(
        IReadOnlyList<LlmChatMessage> history,
        AgentRunState state,
        int inputChars)
    {
        var initial = AgentMessageMapper.ToChatMessages(history).ToList();
        return new InMemoryChatHistoryProvider(new InMemoryChatHistoryProviderOptions
        {
            StateKey = "hetu-request-history",
            StateInitializer = _ => new InMemoryChatHistoryProvider.State { Messages = initial },
            ChatReducer = state.Request.CompressHistory
                ? new HetuChatReducer(_compression, state, inputChars)
                : null,
            ReducerTriggerEvent = InMemoryChatHistoryProviderOptions.ChatReducerTriggerEvent.BeforeMessagesRetrieval,
        });
    }

    private ChatClientAgentOptions BuildAgentOptions(
        AgentRunState state,
        ResolvedAgentModel model,
        IReadOnlyList<LlmChatMessage> history,
        int inputChars)
    {
        var request = state.Request;
        var declared = state.GetDeclaredFunctions().Cast<AITool>().ToList();
        var systemPrompt = ComposeSystemPrompt(
            request.SystemPrompt,
            declared.Count,
            state.LoadableToolNames.Except(state.LoadedToolNames, StringComparer.OrdinalIgnoreCase).ToList(),
            request.MaxToolCallsPerTurn);

        var chatOptions = new AiChatOptions
        {
            Instructions = systemPrompt,
            Tools = declared,
            ToolMode = declared.Count > 0 && request.EnableTools ? ChatToolMode.Auto : ChatToolMode.None,
            Temperature = request.Temperature is { } temperature ? (float?)temperature : null,
            MaxOutputTokens = request.MaxTokens,
            ModelId = model.Model.ModelId,
            Reasoning = string.IsNullOrWhiteSpace(request.ReasoningEffort)
                ? null
                : new ReasoningOptions { Effort = ParseReasoningEffort(request.ReasoningEffort) },
            AdditionalProperties = new AdditionalPropertiesDictionary
            {
                ["ReasoningBudgetTokens"] = request.ReasoningBudgetTokens,
            },
        };

        return new ChatClientAgentOptions
        {
            Name = "hetu",
            ChatOptions = chatOptions,
            ChatHistoryProvider = CreateChatHistoryProvider(history, state, inputChars),
            UseProvidedChatClientAsIs = true,
        };
    }

    private async Task<ToolApprovalResponseContent> RequestApprovalAsync(
        AgentRunState state,
        ToolApprovalRequestContent request,
        CancellationToken ct)
    {
        var functionCall = request.ToolCall as FunctionCallContent;
        var callId = functionCall?.CallId ?? request.RequestId;
        var name = functionCall?.Name ?? request.RequestId;
        var arguments = functionCall != null ? JsonSerializer.Serialize(functionCall.Arguments) : "{}";
        state.ApprovalToolNames[callId] = name;

        var decision = state.PendingToolDecisions.Remove(callId, out var cached)
            ? cached
            : await EvaluatePermissionAsync(state, callId, name, arguments);
        if (!decision.Allowed)
        {
            var denyMessage = decision.DenyMessage ?? _localizer.T("toolExec.denied", name);
            await EmitDeniedToolAsync(state, callId, name, arguments, denyMessage);
            return request.CreateResponse(false, denyMessage);
        }
        if (decision.Mode != ToolApprovalMode.Ask)
            return request.CreateResponse(true);

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

        if (!approved)
        {
            var denyMessage = _localizer.T("toolExec.userDenied", name);
            await EmitDeniedToolAsync(state, callId, name, arguments, denyMessage);
            return request.CreateResponse(false, denyMessage);
        }
        return request.CreateResponse(true);
    }

    private async Task<bool> ShouldAutoApproveAsync(AgentRunState state, ToolAutoApprovalRuleContext context)
    {
        if (context.FunctionCallContent is not FunctionCallContent functionCall)
            return true;

        var executor = _toolRegistry.GetExecutor(functionCall.Name);
        var explicitOverride = state.Request.ToolApprovals.TryGetValue(functionCall.Name, out var byName)
            ? byName
            : state.Request.ToolApprovals.TryGetValue("*", out var byWildcard)
                ? byWildcard
                : (ToolApprovalMode?)null;
        var approval = explicitOverride ?? executor?.DefaultApproval ?? ToolApprovalMode.Auto;
        if (state.Request.DecideToolCall == null)
            return approval != ToolApprovalMode.Ask;

        var decision = await EvaluatePermissionAsync(
            state,
            functionCall.CallId,
            functionCall.Name,
            JsonSerializer.Serialize(functionCall.Arguments));
        state.PendingToolDecisions[functionCall.CallId] = decision;
        return decision.Allowed && decision.Mode != ToolApprovalMode.Ask;
    }

    private async Task<WorkToolDecision> EvaluatePermissionAsync(
        AgentRunState state,
        string callId,
        string toolName,
        string arguments)
    {
        var executor = _toolRegistry.GetExecutor(toolName);
        var explicitOverride = state.Request.ToolApprovals.TryGetValue(toolName, out var byName)
            ? byName
            : state.Request.ToolApprovals.TryGetValue("*", out var byWildcard)
                ? byWildcard
                : (ToolApprovalMode?)null;
        var approval = explicitOverride ?? executor?.DefaultApproval ?? ToolApprovalMode.Auto;
        if (state.Request.DecideToolCall == null)
            return new WorkToolDecision(true, approval);

        var call = new LlmToolCall { Id = callId, Name = toolName, Arguments = arguments };
        var decision = await state.Request.DecideToolCall(call, approval);
        return explicitOverride is { } mode ? decision with { Mode = mode } : decision;
    }

    private async Task EmitDeniedToolAsync(
        AgentRunState state,
        string callId,
        string name,
        string arguments,
        string message)
    {
        state.AppendToolCall(new AgentToolCallRecord
        {
            Id = callId,
            Name = name,
            Arguments = arguments,
            Result = message,
            IsError = true,
        });
        await state.Sink.OnEventAsync(new
        {
            type = "tool_call",
            id = callId,
            name,
            arguments,
        });
        await state.Sink.OnEventAsync(new
        {
            type = "tool_result",
            id = callId,
            name,
            content = message,
            isError = true,
        });
        await state.Sink.OnToolCallAsync(new LlmToolCall { Id = callId, Name = name, Arguments = arguments });
        await state.Sink.OnToolResultAsync(callId, message, true);
    }

    private static string ComposeSystemPrompt(
        string agentPrompt,
        int declaredCount,
        List<string> loadableToolNames,
        int maxToolCallsPerTurn)
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
}