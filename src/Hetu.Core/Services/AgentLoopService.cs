using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Streaming;
using Hetu.Core.Utilities;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>
/// Agent Loop 执行结果
/// </summary>
public class AgentLoopResult
{
    public string Content { get; set; } = string.Empty;
    public string? Thinking { get; set; }
    public List<AgentToolCallRecord> ToolCalls { get; set; } = new();
    public string? ModelId { get; set; }
    /// <summary>整轮累计用量（仅统计 Provider 上报的部分）</summary>
    public LlmUsage Usage { get; set; } = new();
    /// <summary>有序流水：思考 → 正文 → 工具调用 按发生顺序记录，供各端还原执行过程</summary>
    public List<AgentTimelineSegment> Timeline { get; set; } = new();
    /// <summary>实际执行的迭代次数</summary>
    public int Iterations { get; set; }
    /// <summary>是否被用户中断</summary>
    public bool Cancelled { get; set; }
    /// <summary>循环级错误信息（已通知 sink，可由调用方决定落库内容）</summary>
    public string? Error { get; set; }
}

/// <summary>工具调用记录（供落库 / 前端回放）</summary>
public class AgentToolCallRecord
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Arguments { get; set; } = "{}";
    public string? Result { get; set; }
    public bool IsError { get; set; }
}

/// <summary>一次工具执行的结果（含原始调用，供钩子读取参数）</summary>
public sealed class AgentToolExecution
{
    public required LlmToolCall Call { get; init; }
    public required string Result { get; init; }
    public required bool IsError { get; init; }
}

/// <summary>
/// 流水片段。Kind：text | thought | tool。
/// 序列化后与前端 ChatMessageItem / WorkSessionArea 解析的时间线格式一致。
/// </summary>
public class AgentTimelineSegment
{
    public string Kind { get; set; } = "text";
    public string? Content { get; set; }
    public string? Name { get; set; }
    public string? Arguments { get; set; }
    public string? Result { get; set; }
    public bool IsError { get; set; }
}

/// <summary>
/// Agent Loop 执行请求
/// </summary>
public class AgentLoopRequest
{
    public Guid? ModelId { get; set; }
    public string SystemPrompt { get; set; } = string.Empty;
    public List<LlmChatMessage> Messages { get; set; } = new();
    public List<string> ToolNames { get; set; } = new();
    public List<Guid> McpServerIds { get; set; } = new();
    public int MaxIterations { get; set; } = 15;
    public int MaxToolCallsPerTurn { get; set; } = 5;
    public Dictionary<string, ToolApprovalMode> ToolApprovals { get; set; } = new();
    public string SessionId { get; set; } = "";
    public IAgentLoopSink? Sink { get; set; }
    /// <summary>执行过程钩子：落库、检查点、文件变更等各端自有行为</summary>
    public IAgentLoopHooks? Hooks { get; set; }
    /// <summary>是否在每轮前压缩历史消息（默认开，与对话页行为一致）</summary>
    public bool CompressHistory { get; set; } = true;
    /// <summary>触发压缩的消息长度阈值（字符），默认 500</summary>
    public int CompressionThreshold { get; set; } = 500;
    /// <summary>
    /// 提问处理器：非空时 ask_question 由该回调裁决（后台任务可中断执行转人工），
    /// 为空时走 SSE 会话等待用户回答。
    /// </summary>
    public Func<LlmToolCall, Task<string>>? QuestionHandler { get; set; }
    /// <summary>逐次工具决策（权限模式 / 项目规则）</summary>
    public Func<LlmToolCall, ToolApprovalMode, WorkToolDecision>? DecideToolCall { get; set; }
    /// <summary>工作项目作用域：非空时 work_* 工具在该项目目录（或 SSH 远端）内执行</summary>
    public WorkToolScope? WorkScope { get; set; }
    /// <summary>是否启用工具调用（关闭时即使有工具也不执行，直接结束）</summary>
    public bool EnableTools { get; set; } = true;
}

/// <summary>
/// Agent Loop 事件接收器。所有端（SSE 对话 / SSE 编码会话 / 看板任务 / 工作流 Agent 节点）
/// 实现同一接口，把事件转发到各自的输出通道。
/// </summary>
public interface IAgentLoopSink
{
    Task OnContentAsync(string text) => Task.CompletedTask;
    Task OnThinkingAsync(string text) => Task.CompletedTask;
    Task OnToolCallAsync(LlmToolCall toolCall) => Task.CompletedTask;
    Task OnToolResultAsync(string toolCallId, string content, bool isError) => Task.CompletedTask;
    Task OnDebugAsync(string text) => Task.CompletedTask;
    /// <summary>循环级错误（已由内核捕获，端上可转错误帧或落库）</summary>
    Task OnErrorAsync(string message) => Task.CompletedTask;
    /// <summary>
    /// 工具执行过程中的结构化事件直通转发（tool_call / tool_result /
    /// approval_request / question / todo / plan）。SSE 端直接写帧，
    /// 非流式端可忽略。
    /// </summary>
    Task OnEventAsync(object payload) => Task.CompletedTask;
    /// <summary>累计用量变化（仅当 Provider 上报了用量时触发）</summary>
    Task OnUsageAsync(LlmUsage usage) => Task.CompletedTask;
}

/// <summary>
/// 执行过程钩子：让各端在不复制循环的前提下保留自有行为
/// （对话页落库助手消息、编码页打检查点与记录文件变更）。
/// </summary>
public interface IAgentLoopHooks
{
    /// <summary>每轮模型响应完成（工具执行前）：content/thinking 已就绪</summary>
    Task OnIterationAsync(int iteration, string content, string thinking, LlmUsage? usage) => Task.CompletedTask;
    /// <summary>工具执行前：可读取旧内容、打检查点</summary>
    Task BeforeToolCallsAsync(IReadOnlyList<LlmToolCall> toolCalls) => Task.CompletedTask;
    /// <summary>工具执行后：可记录文件变更、落库工具结果</summary>
    Task AfterToolResultsAsync(IReadOnlyList<AgentToolExecution> results) => Task.CompletedTask;
}

/// <summary>
/// 可复用的 Agent Loop 服务，是全部 Agent 执行路径（对话、编码会话、看板任务、工作流 Agent 节点）
/// 的唯一内核：LLM 流式调用 + 工具调用迭代 + 历史压缩 + 用量累计 + 流水记录。
/// 不依赖 HttpResponse，通过 <see cref="IAgentLoopSink"/> 与 <see cref="IAgentLoopHooks"/> 输出事件。
/// </summary>
public class AgentLoopService
{
    private const int DefaultMaxIterations = 15;

    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly ToolRegistry _toolRegistry;
    private readonly ToolExecutionService _toolExecution;
    private readonly CompressionPipelineService _compressionPipeline;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<AgentLoopService> _logger;

    public AgentLoopService(
        ILLMProviderFactory llmProviderFactory,
        ToolRegistry toolRegistry,
        ToolExecutionService toolExecution,
        CompressionPipelineService compressionPipeline,
        IUnitOfWork unitOfWork,
        ILogger<AgentLoopService> logger)
    {
        _llmProviderFactory = llmProviderFactory;
        _toolRegistry = toolRegistry;
        _toolExecution = toolExecution;
        _compressionPipeline = compressionPipeline;
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    /// <summary>
    /// 异步加载指定 MCP 服务器的工具并注册为运行时工具，返回适配后的工具名列表。
    /// 失败的服务器会被跳过并记录日志。
    /// </summary>
    public async Task<List<string>> LoadMcpToolsAsync(List<Guid> mcpServerIds, CancellationToken ct)
    {
        var names = new List<string>();
        if (mcpServerIds is null || mcpServerIds.Count == 0) return names;

        foreach (var serverId in mcpServerIds)
        {
            var server = await _unitOfWork.McpServers.GetByIdAsync(serverId, ct);
            if (server == null || !server.IsEnabled || server.Type != "stdio")
            {
                _logger.LogWarning("跳过 MCP 服务器 {ServerId}：不存在/已禁用/非 stdio", serverId);
                continue;
            }

            try
            {
                using var client = new StdioMcpClient(server.ConnectionConfig);
                var tools = await client.ListToolsAsync(ct);
                foreach (var tool in tools)
                {
                    var adapter = new McpToolAdapter(server.Name, server.ConnectionConfig, tool);
                    _toolRegistry.AddRuntimeTool(adapter);
                    names.Add(adapter.Name);
                }
                _logger.LogInformation("从 MCP 服务器 {ServerName} 加载 {Count} 个工具", server.Name, tools.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "加载 MCP 服务器 {ServerName} 工具失败", server.Name);
            }
        }
        return names;
    }

    /// <summary>执行 Agent Loop，返回最终内容、工具调用历史、累计用量与流水。</summary>
    public async Task<AgentLoopResult> RunAsync(AgentLoopRequest request, CancellationToken ct)
    {
        var sink = request.Sink ?? new NullAgentLoopSink();
        var hooks = request.Hooks;
        var result = new AgentLoopResult();

        // 1. 解析 LLM Provider
        ILLMProvider? provider;
        if (request.ModelId.HasValue)
        {
            provider = await _llmProviderFactory.CreateProviderAsync(request.ModelId.Value, ct);
            result.ModelId = request.ModelId.Value.ToString();
        }
        else
        {
            provider = await _llmProviderFactory.CreateChatProviderAsync(ct);
        }
        if (provider == null)
            throw new InvalidOperationException("未找到可用的对话模型，请先在设置中配置 AI 模型");

        // 2. 加载 MCP 工具并合并工具名
        var mcpToolNames = await LoadMcpToolsAsync(request.McpServerIds, ct);
        var allToolNames = request.ToolNames.Concat(mcpToolNames).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        // 3. 构建 ChatOptions（ModelId 留空，由 provider 内置的真实模型名生效，避免误传 Guid）
        var options = new ChatOptions
        {
            ModelId = "",
            Stream = true,
            SystemPrompt = ComposeSystemPrompt(request.SystemPrompt, allToolNames, request.MaxToolCallsPerTurn),
            Tools = _toolRegistry.ToToolDefinitions(allToolNames),
            ToolChoice = allToolNames.Count > 0 ? "auto" : "none"
        };

        _logger.LogInformation("[AgentLoop] tools={ToolCount} names={ToolNames} toolChoice={ToolChoice} systemPrompt={SystemPrompt}",
            options.Tools?.Count ?? 0, string.Join(",", allToolNames), options.ToolChoice, options.SystemPrompt?.Length > 200 ? options.SystemPrompt[..200] : options.SystemPrompt);

        var chatMessages = new List<LlmChatMessage>(request.Messages);
        var sessionTodos = new List<SessionTodo>();
        var maxIter = request.MaxIterations > 0 ? request.MaxIterations : DefaultMaxIterations;
        var threshold = request.CompressionThreshold > 0 ? request.CompressionThreshold : 500;

        try
        {
            // 4. Agent Loop
            for (int iter = 0; iter < maxIter; iter++)
            {
                result.Iterations = iter + 1;
                await sink.OnDebugAsync($"Agent 迭代 {iter + 1}，工具数={options.Tools?.Count ?? 0}");

                // 每轮前压缩历史：长消息按压缩管道收敛，控制上下文膨胀
                if (request.CompressHistory)
                {
                    for (int i = 0; i < chatMessages.Count; i++)
                    {
                        var msg = chatMessages[i];
                        if (string.IsNullOrWhiteSpace(msg.Content) || msg.Content.Length < threshold) continue;
                        var compressed = await _compressionPipeline.CompressAsync(msg.Content, ct);
                        if (compressed != msg.Content && !string.IsNullOrWhiteSpace(compressed))
                        {
                            chatMessages[i] = new LlmChatMessage { Role = msg.Role, Content = compressed, ContentParts = msg.ContentParts, ToolCallId = msg.ToolCallId, ToolCalls = msg.ToolCalls };
                        }
                    }
                }

                var (content, thinking, pendingToolCalls, usage) = await ProcessStreamAsync(provider, chatMessages, options, sink, ct);

                _logger.LogInformation("[AgentLoop] iter={Iter} contentLen={ContentLen} thinkingLen={ThinkingLen} toolCalls={ToolCallCount}",
                    iter, content.Length, thinking?.Length ?? 0, pendingToolCalls?.Count ?? 0);

                AccumulateUsage(result.Usage, usage);
                if (usage != null) await sink.OnUsageAsync(result.Usage);

                var iterContent = content.ToString();
                var iterThinking = thinking?.ToString() ?? string.Empty;

                result.Content += iterContent;
                if (iterThinking.Length > 0) result.Thinking += iterThinking;

                await (hooks?.OnIterationAsync(iter, iterContent, iterThinking, usage) ?? Task.CompletedTask);

                if (pendingToolCalls == null || pendingToolCalls.Count == 0 || !request.EnableTools || allToolNames.Count == 0)
                    break;

                // 有序流水：本轮按 思考 → 文本 的发生顺序记录，前端才能穿插还原
                if (iterThinking.Length > 0)
                    result.Timeline.Add(new AgentTimelineSegment { Kind = "thought", Content = iterThinking });
                if (iterContent.Length > 0)
                    result.Timeline.Add(new AgentTimelineSegment { Kind = "text", Content = iterContent });

                chatMessages.Add(new LlmChatMessage
                {
                    Role = "assistant",
                    Content = iterContent,
                    ToolCalls = pendingToolCalls
                });

                await (hooks?.BeforeToolCallsAsync(pendingToolCalls) ?? Task.CompletedTask);

                var toolResults = await _toolExecution.ExecuteToolCallsAsync(
                    request.SessionId,
                    pendingToolCalls,
                    request.ToolApprovals,
                    sessionTodos,
                    data => sink.OnEventAsync(data),
                    // ToolExecutionService 的交互事件（approval_request / question / todo / plan）一律经 sink 直通，
                    // 各端自行决定写 SSE 帧还是忽略
                    payload => sink.OnEventAsync(payload),
                    ct,
                    decideToolCall: request.DecideToolCall,
                    workScope: request.WorkScope,
                    questionHandler: request.QuestionHandler);

                var executions = new List<AgentToolExecution>(toolResults.Count);
                foreach (var (toolCallId, toolContent, resultIsError) in toolResults)
                {
                    var call = pendingToolCalls.FirstOrDefault(tc => tc.Id == toolCallId);
                    var isError = resultIsError || toolContent.StartsWith("Error:", StringComparison.OrdinalIgnoreCase);

                    if (call != null)
                    {
                        await sink.OnToolCallAsync(call);
                        result.ToolCalls.Add(new AgentToolCallRecord
                        {
                            Id = toolCallId,
                            Name = call.Name,
                            Arguments = call.Arguments,
                            Result = toolContent,
                            IsError = isError,
                        });
                        result.Timeline.Add(new AgentTimelineSegment
                        {
                            Kind = "tool",
                            Name = call.Name,
                            Arguments = call.Arguments,
                            Result = toolContent,
                            IsError = isError,
                        });
                        executions.Add(new AgentToolExecution { Call = call, Result = toolContent, IsError = isError });
                    }

                    await sink.OnToolResultAsync(toolCallId, toolContent, isError);
                    chatMessages.Add(new LlmChatMessage { Role = "tool", ToolCallId = toolCallId, Content = toolContent });
                }

                await (hooks?.AfterToolResultsAsync(executions) ?? Task.CompletedTask);
            }
        }
        catch (OperationCanceledException)
        {
            result.Cancelled = true;
            _logger.LogInformation("[AgentLoop] 用户中断 session={SessionId}", request.SessionId);
        }
        catch (Exception ex)
        {
            result.Error = ex.Message;
            _logger.LogError(ex, "[AgentLoop] 循环异常 session={SessionId}", request.SessionId);
            try { await sink.OnErrorAsync(ex.Message); } catch { }
        }
        finally
        {
            // 5. 清理运行时 MCP 工具
            _toolRegistry.ClearRuntimeTools();
        }

        return result;
    }

    /// <summary>累计用量（Provider 未上报时保持原值）</summary>
    private static void AccumulateUsage(LlmUsage total, LlmUsage? delta)
    {
        if (delta == null) return;
        total.PromptTokens += delta.PromptTokens;
        total.CompletionTokens += delta.CompletionTokens;
        total.TotalTokens += delta.TotalTokens;
        total.CachedTokens += delta.CachedTokens;
    }

    /// <summary>消费 LLM 流，累积 content/thinking/toolcalls/usage，转发到 sink。</summary>
    private async Task<(StringBuilder content, StringBuilder? thinking, List<LlmToolCall>? toolCalls, LlmUsage? usage)> ProcessStreamAsync(
        ILLMProvider provider,
        List<LlmChatMessage> chatMessages,
        ChatOptions options,
        IAgentLoopSink sink,
        CancellationToken ct)
    {
        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        List<LlmToolCall>? pendingToolCalls = null;
        LlmUsage? usage = null;

        var parser = new LlmStreamParser();

        await foreach (var delta in provider.ChatStreamAsync(chatMessages, options, ct))
        {
            foreach (var chunk in parser.Parse(delta))
            {
                switch (chunk.Type)
                {
                    case LlmStreamEventType.Content:
                        contentSb.Append(chunk.Text);
                        await sink.OnContentAsync(chunk.Text);
                        break;
                    case LlmStreamEventType.Thinking:
                        thinkingSb.Append(chunk.Text);
                        await sink.OnThinkingAsync(chunk.Text);
                        break;
                    case LlmStreamEventType.ToolCalls:
                        pendingToolCalls = chunk.ToolCalls;
                        break;
                    case LlmStreamEventType.Usage:
                        usage = chunk.Usage;
                        break;
                }
            }
        }

        foreach (var chunk in parser.Flush())
        {
            if (chunk.Type == LlmStreamEventType.Thinking)
            {
                thinkingSb.Append(chunk.Text);
                await sink.OnThinkingAsync(chunk.Text);
            }
            else
            {
                contentSb.Append(chunk.Text);
                await sink.OnContentAsync(chunk.Text);
            }
        }

        if (pendingToolCalls is { Count: > 0 })
        {
            _logger.LogInformation("[AgentLoop] parsed tool_calls count={Count} names={Names}",
                pendingToolCalls.Count, string.Join(",", pendingToolCalls.Select(t => t.Name)));
        }

        return (contentSb, thinkingSb, pendingToolCalls, usage);
    }

    /// <summary>组装 Agent 系统提示词：人设 + 工具使用约定</summary>
    private string ComposeSystemPrompt(string agentPrompt, List<string> toolNames, int maxToolCallsPerTurn)
    {
        var sb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(agentPrompt))
            sb.AppendLine(agentPrompt.Trim());

        if (toolNames.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("# 工具使用约定");
            sb.AppendLine($"- 单轮回复内工具调用尽量不超过 {maxToolCallsPerTurn} 次；能直接回答的问题不要无脑调用工具");
            sb.AppendLine("- 工具调用失败最多重试 1 次，仍失败则切换策略或如实告知");
            sb.AppendLine("- 不要在正文中自述「调用了哪个工具」，直接给结果");
            sb.AppendLine();
            sb.AppendLine($"本会话可用的工具（共 {toolNames.Count} 个）：");
            foreach (var name in toolNames)
            {
                var executor = _toolRegistry.GetExecutor(name);
                sb.AppendLine($"- `{name}`：{executor?.Description ?? "MCP 工具"}");
            }
        }

        return sb.ToString().TrimEnd();
    }

    private class NullAgentLoopSink : IAgentLoopSink { }
}
