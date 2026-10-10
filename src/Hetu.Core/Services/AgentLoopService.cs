using System.Text;
using System.Text.Json;
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
    /// <summary>首轮请求里压缩管道处理的输入字符数（压缩前），供用量日志「输入 / 压缩后」展示；0 = 本轮无内容需要压缩</summary>
    public int FirstIterationInputChars { get; set; }
    /// <summary>首轮请求里压缩管道的输出字符数（压缩后）</summary>
    public int FirstIterationCompressedChars { get; set; }
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
    /// <summary>
    /// 常驻声明给模型的工具名（其余工具只在系统提示里列名，模型用 load_tools 按需加载 schema）。
    /// 为空表示全部工具都直接声明（保持原行为）。
    /// </summary>
    public IReadOnlyList<string>? CoreToolNames { get; set; }
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

        // 3. 工具声明：常驻核心工具直接声明 schema，其余只在系统提示里列名，模型用 load_tools 按需加载
        // MCP 工具属于本次会话显式挂载的能力，始终声明（名字不足以让模型判断用途）
        var coreToolNames = request.CoreToolNames is { Count: > 0 }
            ? allToolNames.Where(n => mcpToolNames.Contains(n, StringComparer.OrdinalIgnoreCase) ||
                                      request.CoreToolNames.Contains(n, StringComparer.OrdinalIgnoreCase)).ToList()
            : allToolNames;
        var loadableToolNames = allToolNames.Except(coreToolNames, StringComparer.OrdinalIgnoreCase).ToList();
        var loadedToolNames = new List<string>();

        // 3.1 构建 ChatOptions（ModelId 留空，由 provider 内置的真实模型名生效，避免误传 Guid）
        var options = new ChatOptions
        {
            ModelId = "",
            Stream = true,
            ToolChoice = allToolNames.Count > 0 ? "auto" : "none",
        };
        RefreshDeclaredTools();

        // 上下文占用观测：系统提示与工具 schema 是本轮请求的固定开销，逐条长度便于定位膨胀
        var systemPromptChars = options.SystemPrompt?.Length ?? 0;
        var toolSchemaChars = LlmTokenEstimator.ToolDefinitionChars(options.Tools);
        _logger.LogInformation("[AgentLoop] tools={ToolCount}（按需可加载 {LoadableCount}） toolChoice={ToolChoice} 固定开销 systemPrompt={SystemChars}字符 tools={ToolChars}字符 合计≈{FixedTokens} tokens",
            options.Tools?.Count ?? 0, loadableToolNames.Count, options.ToolChoice, systemPromptChars, toolSchemaChars,
            LlmTokenEstimator.EstimateChars(systemPromptChars + toolSchemaChars));

        var chatMessages = new List<LlmChatMessage>(request.Messages);
        // 历史压缩只处理本轮之前的内容：当前用户消息（初始列表最后一条）及其后新产生的助手/工具消息
        // 不压缩，否则用户原话会被摘要掉、模型拿到的请求与用户输入不一致
        var historyCompressBoundary = Math.Max(0, chatMessages.Count - 1);
        var sessionTodos = new List<SessionTodo>();
        var maxIter = request.MaxIterations > 0 ? request.MaxIterations : DefaultMaxIterations;
        // 已压缩过的消息下标：长会话反复迭代时不再重复压缩（LLM 摘要模式尤其重要）
        var compressedIndexes = new HashSet<int>();

        // 声明 = 常驻核心 + 本轮已按需加载；系统提示里的可加载清单随之收缩
        void RefreshDeclaredTools()
        {
            var declared = coreToolNames.Concat(loadedToolNames).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            options.Tools = _toolRegistry.ToToolDefinitions(declared);
            options.SystemPrompt = ComposeSystemPrompt(
                request.SystemPrompt,
                declared.Count,
                loadableToolNames.Except(loadedToolNames, StringComparer.OrdinalIgnoreCase).ToList(),
                request.MaxToolCallsPerTurn);
        }

        try
        {
            // 4. Agent Loop
            for (int iter = 0; iter < maxIter; iter++)
            {
                result.Iterations = iter + 1;
                RefreshDeclaredTools();
                await sink.OnDebugAsync($"Agent 迭代 {iter + 1}，工具数={options.Tools?.Count ?? 0}");

                // 每轮前压缩历史：算法节点对任意长度生效，LLM 摘要由管道内部按阈值决定
                if (request.CompressHistory)
                {
                    if (iter == 0)
                        _logger.LogInformation("[Compression] {Pipeline}", await _compressionPipeline.DescribeAsync(ct));

                    var candidates = 0;
                    var compressedCount = 0;
                    var beforeChars = 0;
                    var afterChars = 0;
                    var pending = new List<(int Index, string Text)>();
                    for (int i = 0; i < chatMessages.Count; i++)
                    {
                        if (i >= historyCompressBoundary) break; // 本轮新增内容不压缩（见上）
                        var msg = chatMessages[i];
                        if (string.IsNullOrWhiteSpace(msg.Content)) continue;
                        if (!compressedIndexes.Add(i)) continue;
                        candidates++;
                        beforeChars += msg.Content.Length;
                        pending.Add((i, msg.Content));
                    }

                    if (pending.Count > 0)
                    {
                        // 并行压缩：LLM 摘要每条一次模型调用，串行会把一轮的等待时间累加（7 条 ≈ 20s）
                        var compressedTexts = await Task.WhenAll(pending.Select(p => _compressionPipeline.CompressAsync(p.Text, ct)));
                        for (var k = 0; k < pending.Count; k++)
                        {
                            var (index, original) = pending[k];
                            var compressed = compressedTexts[k];
                            if (compressed != original && !string.IsNullOrWhiteSpace(compressed))
                            {
                                var msg = chatMessages[index];
                                chatMessages[index] = new LlmChatMessage { Role = msg.Role, Content = compressed, ContentParts = msg.ContentParts, ToolCallId = msg.ToolCallId, ToolCalls = msg.ToolCalls };
                                compressedCount++;
                                afterChars += compressed.Length;
                            }
                            else
                            {
                                afterChars += original.Length;
                            }
                        }
                    }

                    if (candidates > 0)
                    {
                        _logger.LogInformation(
                            "[Compression] iter={Iter} 候选={Candidates} 条 实际压缩={Compressed} 条 字符 {Before} → {After}",
                            iter + 1, candidates, compressedCount, beforeChars, afterChars);
                    }

                    // 用量日志的「输入 / 压缩后」：记首轮请求压缩管道的实际规模（有压缩时才记）
                    if (iter == 0 && beforeChars > 0)
                    {
                        result.FirstIterationInputChars = beforeChars;
                        result.FirstIterationCompressedChars = afterChars;
                    }
                }
                else if (iter == 0)
                {
                    _logger.LogInformation("[Compression] 本轮未启用历史压缩（CompressHistory=false）");
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

                // load_tools：把本轮加载的工具并入下一轮声明（schema 下一轮随请求下发）
                foreach (var call in pendingToolCalls)
                {
                    if (!string.Equals(call.Name, "load_tools", StringComparison.OrdinalIgnoreCase)) continue;
                    foreach (var loaded in ParseLoadedToolNames(call.Arguments))
                    {
                        if (loadableToolNames.Contains(loaded, StringComparer.OrdinalIgnoreCase) &&
                            !loadedToolNames.Contains(loaded, StringComparer.OrdinalIgnoreCase))
                        {
                            loadedToolNames.Add(loaded);
                        }
                    }
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

    /// <summary>
    /// 组装 Agent 系统提示词：人设 + 工具使用约定。
    /// 已声明的工具只写通用约定（名字/说明/参数都在随请求下发的 tools schema 里）；
    /// 未声明的工具在这里列名，模型需要时用 load_tools 取回 schema 再调用。
    /// </summary>
    private static string ComposeSystemPrompt(string agentPrompt, int declaredCount, List<string> loadableToolNames, int maxToolCallsPerTurn)
    {
        var sb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(agentPrompt))
            sb.AppendLine(agentPrompt.Trim());

        if (declaredCount > 0 || loadableToolNames.Count > 0)
        {
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
                    var names = loadableToolNames.Where(n => ToolGroupMap.Resolve(n) == group).ToList();
                    if (names.Count == 0) continue;
                    sb.AppendLine($"- {group}: {string.Join("、", names)}");
                }
            }
        }

        return sb.ToString().TrimEnd();
    }

    /// <summary>解析 load_tools 调用参数里的工具名列表（names 数组，兼容单个 name）</summary>
    private static List<string> ParseLoadedToolNames(string argumentsJson)
    {
        var names = new List<string>();
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            if (doc.RootElement.TryGetProperty("names", out var array) && array.ValueKind == JsonValueKind.Array)
            {
                names.AddRange(array.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString() ?? string.Empty)
                    .Where(n => n.Length > 0));
            }
            else if (doc.RootElement.TryGetProperty("name", out var single) && single.ValueKind == JsonValueKind.String)
            {
                names.Add(single.GetString() ?? string.Empty);
            }
        }
        catch (JsonException)
        {
            // 参数不合法时交给 load_tools 的执行结果反馈，这里忽略
        }
        return names;
    }

    private class NullAgentLoopSink : IAgentLoopSink { }
}
