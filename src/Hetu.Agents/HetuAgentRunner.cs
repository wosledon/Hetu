using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
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
    private const int MaxConcurrentCompressions = 3;

    private readonly IAgentFactory _agentFactory;
    private readonly ToolRegistry _toolRegistry;
    private readonly ToolExecutionService _toolExecution;
    private readonly CompressionPipelineService _compression;
    private readonly ILocalizer _localizer;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<HetuAgentRunner> _logger;

    public HetuAgentRunner(
        IAgentFactory agentFactory,
        ToolRegistry toolRegistry,
        ToolExecutionService toolExecution,
        CompressionPipelineService compression,
        ILocalizer localizer,
        IUnitOfWork unitOfWork,
        ILogger<HetuAgentRunner> logger)
    {
        _agentFactory = agentFactory;
        _toolRegistry = toolRegistry;
        _toolExecution = toolExecution;
        _compression = compression;
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

    public async Task<List<string>> LoadMcpToolsAsync(List<Guid> mcpServerIds, CancellationToken ct)
    {
        var names = new List<string>();
        if (mcpServerIds is null || mcpServerIds.Count == 0) return names;

        var servers = (await _unitOfWork.McpServers.FindAsync(s => mcpServerIds.Contains(s.Id), ct))
            .ToDictionary(s => s.Id);
        foreach (var serverId in mcpServerIds)
        {
            var server = servers.GetValueOrDefault(serverId);
            if (server == null || !server.IsEnabled || server.Type != "stdio")
            {
                _logger.LogWarning("跳过 MCP 服务器 {ServerId}：不存在/已禁用/非 stdio", serverId);
                continue;
            }

            try
            {
                var client = await McpClientPool.Shared.GetAsync(server.ConnectionConfig, _localizer, ct);
                var tools = await client.ListToolsAsync(ct);
                foreach (var tool in tools)
                {
                    var adapter = new McpToolAdapter(server.Name, server.ConnectionConfig, tool, _localizer);
                    _toolRegistry.AddRuntimeTool(adapter);
                    names.Add(adapter.Name);
                }
                _logger.LogInformation("从 MCP 服务器 {ServerName} 加载 {Count} 个工具", server.Name, tools.Count);
            }
            catch (Exception ex)
            {
                McpClientPool.Shared.Invalidate(server.ConnectionConfig);
                _logger.LogError(ex, "加载 MCP 服务器 {ServerName} 工具失败", server.Name);
            }
        }
        return names;
    }

    public async Task<AgentLoopResult> RunAsync(AgentLoopRequest request, CancellationToken ct)
    {
        var resolved = await _agentFactory.ResolveAsync(request.ModelId, ct)
                       ?? throw new InvalidOperationException(_localizer.T("model.noModelConfigured"));
        request.ModelId ??= resolved.Model.Id;
        var mcpToolNames = await LoadMcpToolsAsync(request.McpServerIds, ct);
        var state = new AgentRunState(request);
        state.Result.ModelId = resolved.Model.Id.ToString();

        try
        {
            await PrepareHistoryAsync(state, ct);
            BuildTools(state, mcpToolNames);

            var options = BuildAgentOptions(state, resolved);
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
            var input = AgentMessageMapper.ToChatMessages(state.ChatMessages);

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
                            case FunctionResultContent result when !state.RecordedToolCallIds.Contains(result.CallId):
                                {
                                    // 审批被拒绝等未进入工具函数的结果，由 MAF 直接生成；补一条 SSE tool_result，避免前端卡片悬挂。
                                    var resultText = AgentMessageMapper.ConvertResult(result.Result);
                                    var name = state.ApprovalToolNames.GetValueOrDefault(result.CallId) ?? "tool";
                                    state.AppendToolCall(new AgentToolCallRecord
                                    {
                                        Id = result.CallId,
                                        Name = name,
                                        Result = resultText,
                                        IsError = true,
                                    });
                                    await state.Sink.OnEventAsync(new
                                    {
                                        type = "tool_result",
                                        id = result.CallId,
                                        name,
                                        content = resultText,
                                        isError = true,
                                    });
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
        finally
        {
            if (!request.PreserveRuntimeTools) _toolRegistry.ClearRuntimeTools();
        }

        return state.Result;
    }

    private async Task PrepareHistoryAsync(AgentRunState state, CancellationToken ct)
    {
        state.ChatMessages = new List<LlmChatMessage>(state.Request.Messages);
        if (!state.Request.CompressHistory || state.ChatMessages.Count == 0) return;

        var beforeChars = state.ChatMessages.Sum(m => (long)(m.Content?.Length ?? 0));
        using var gate = new SemaphoreSlim(MaxConcurrentCompressions, MaxConcurrentCompressions);
        var prepared = await Task.WhenAll(state.ChatMessages.Select(async message =>
        {
            await gate.WaitAsync(ct);
            try { return await _compression.PrepareForContextAsync(message.Content ?? string.Empty, ct); }
            finally { gate.Release(); }
        }));

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
        }

        var afterChars = state.ChatMessages.Sum(m => (long)(m.Content?.Length ?? 0));
        state.Result.FirstIterationInputChars = (int)beforeChars;
        state.Result.FirstIterationCompressedChars = (int)afterChars;
    }

    private void BuildTools(AgentRunState state, IReadOnlyList<string> mcpToolNames)
    {
        var request = state.Request;
        var allNames = request.ToolNames.Concat(mcpToolNames)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        state.CoreToolNames = request.CoreToolNames is { Count: > 0 }
            ? allNames.Where(name => mcpToolNames.Contains(name, StringComparer.OrdinalIgnoreCase)
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
            var executor = _toolRegistry.GetExecutor(name);
            if (executor == null) continue;

            var description = _toolRegistry.Describe(executor);
            var guideline = _toolRegistry.Guideline(executor);
            if (!string.IsNullOrWhiteSpace(guideline)) description = $"{description}｜{guideline}";
            var schemaText = _toolRegistry.LocalizeParameters(executor.Name, executor.ParametersSchema.GetRawText())
                             ?? executor.ParametersSchema.GetRawText();
            using var schemaDoc = JsonDocument.Parse(schemaText);
            var schema = schemaDoc.RootElement.Clone();

            AIFunction function = new HetuAIFunction(
                executor, _toolExecution, _compression, _localizer, state, _logger,
                description, schema);

            // 交互工具自己等待用户输入；其余工具都交给 MAF 审批管道，由 ToolApprovalAgent 按当前权限模式自动放行或询问。
            if (!InteractiveTools.IsInteractive(executor.Name))
                function = new ApprovalRequiredAIFunction(function);

            state.Functions[name] = function;
        }
    }

    private ChatClientAgentOptions BuildAgentOptions(
        AgentRunState state,
        ResolvedAgentModel model)
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

        return request.CreateResponse(approved, approved ? null : _localizer.T("toolExec.userDenied", name));
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

        var call = new LlmToolCall
        {
            Id = functionCall.CallId,
            Name = functionCall.Name,
            Arguments = JsonSerializer.Serialize(functionCall.Arguments),
        };
        var decision = await state.Request.DecideToolCall(call, approval);
        return !decision.Allowed || (explicitOverride ?? decision.Mode) != ToolApprovalMode.Ask;
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