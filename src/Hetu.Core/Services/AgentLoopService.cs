using System.Text;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
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
}

public class AgentToolCallRecord
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Arguments { get; set; } = "{}";
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
}

/// <summary>
/// Agent Loop 事件接收器。工作流执行器和对话控制器可各自实现，把事件转发到 SSE 或节点进度。
/// </summary>
public interface IAgentLoopSink
{
    Task OnContentAsync(string text) => Task.CompletedTask;
    Task OnThinkingAsync(string text) => Task.CompletedTask;
    Task OnToolCallAsync(LlmToolCall toolCall) => Task.CompletedTask;
    Task OnToolResultAsync(string toolCallId, string content, bool isError) => Task.CompletedTask;
    Task OnDebugAsync(string text) => Task.CompletedTask;
}

/// <summary>
/// 可复用的 Agent Loop 服务。封装 LLM 流式调用 + 工具调用的迭代循环，
/// 供工作流的 Agent 节点执行器复用。不依赖 HttpResponse，通过 <see cref="IAgentLoopSink"/> 输出事件。
/// </summary>
public class AgentLoopService
{
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly ToolRegistry _toolRegistry;
    private readonly ToolExecutionService _toolExecution;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<AgentLoopService> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public AgentLoopService(
        ILLMProviderFactory llmProviderFactory,
        ToolRegistry toolRegistry,
        ToolExecutionService toolExecution,
        IUnitOfWork unitOfWork,
        ILogger<AgentLoopService> logger)
    {
        _llmProviderFactory = llmProviderFactory;
        _toolRegistry = toolRegistry;
        _toolExecution = toolExecution;
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

    /// <summary>执行 Agent Loop，返回最终内容与工具调用历史</summary>
    public async Task<AgentLoopResult> RunAsync(AgentLoopRequest request, CancellationToken ct)
    {
        var sink = request.Sink ?? new NullAgentLoopSink();
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

        // 3. 构建 ChatOptions
        var options = new ChatOptions
        {
            ModelId = result.ModelId ?? "",
            Stream = true,
            SystemPrompt = ComposeSystemPrompt(request.SystemPrompt, allToolNames, request.MaxToolCallsPerTurn),
            Tools = _toolRegistry.ToToolDefinitions(allToolNames),
            ToolChoice = allToolNames.Count > 0 ? "auto" : "none"
        };

        var chatMessages = new List<LlmChatMessage>(request.Messages);
        var sessionTodos = new List<SessionTodo>();
        var maxIter = request.MaxIterations > 0 ? request.MaxIterations : 15;

        // 4. Agent Loop
        for (int iter = 0; iter < maxIter; iter++)
        {
            await sink.OnDebugAsync($"Agent 迭代 {iter + 1}，工具数={options.Tools?.Count ?? 0}");

            var (content, thinking, pendingToolCalls) = await ProcessStreamAsync(provider, chatMessages, options, sink, ct);

            result.Content += content;
            if (!string.IsNullOrEmpty(thinking)) result.Thinking += thinking;

            if (pendingToolCalls == null || pendingToolCalls.Count == 0 || allToolNames.Count == 0)
                break;

            chatMessages.Add(new LlmChatMessage
            {
                Role = "assistant",
                Content = content.ToString(),
                ToolCalls = pendingToolCalls
            });

            // 执行工具
            var toolResults = await _toolExecution.ExecuteToolCallsAsync(
                request.SessionId,
                pendingToolCalls,
                request.ToolApprovals,
                sessionTodos,
                _ => Task.CompletedTask,
                async payload =>
                {
                    // 转发 tool_call 事件到 sink
                    if (payload is JsonElement je && je.TryGetProperty("type", out var tEl) && tEl.GetString() == "tool_call")
                    {
                        var name = je.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? "" : "";
                        var id = je.TryGetProperty("id", out var iEl) ? iEl.GetString() ?? "" : "";
                        var args = je.TryGetProperty("arguments", out var aEl) ? aEl.GetRawText() : "{}";
                        await sink.OnToolCallAsync(new LlmToolCall { Id = id, Name = name, Arguments = args });
                    }
                },
                ct);

            foreach (var (toolCallId, content2) in toolResults)
            {
                var isError = content2.StartsWith("Error:", StringComparison.OrdinalIgnoreCase);
                await sink.OnToolResultAsync(toolCallId, content2, isError);
                result.ToolCalls.Add(new AgentToolCallRecord
                {
                    Id = toolCallId,
                    // 名称需从 pendingToolCalls 中查找
                    Name = pendingToolCalls.FirstOrDefault(tc => tc.Id == toolCallId)?.Name ?? "",
                    Result = content2,
                    IsError = isError
                });
                chatMessages.Add(new LlmChatMessage { Role = "tool", ToolCallId = toolCallId, Content = content2 });
            }
        }

        // 5. 清理运行时 MCP 工具
        _toolRegistry.ClearRuntimeTools();

        return result;
    }

    /// <summary>消费 LLM 流，累积 content/thinking/toolcalls，转发到 sink。不依赖 HttpResponse。</summary>
    private static async Task<(string content, string thinking, List<LlmToolCall>? toolCalls)> ProcessStreamAsync(
        ILLMProvider provider,
        List<LlmChatMessage> chatMessages,
        ChatOptions options,
        IAgentLoopSink sink,
        CancellationToken ct)
    {
        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        List<LlmToolCall>? pendingToolCalls = null;

        var state = new ThinkingTagState();

        await foreach (var delta in provider.ChatStreamAsync(chatMessages, options, ct))
        {
            // 尝试解析结构化 JSON（native thinking / tool_calls）
            var parsed = false;
            try
            {
                using var doc = JsonDocument.Parse(delta);
                if (doc.RootElement.TryGetProperty("type", out var typeEl))
                {
                    var typeStr = typeEl.GetString();
                    var text = doc.RootElement.TryGetProperty("text", out var textEl) ? textEl.GetString() ?? "" : "";
                    if (typeStr == "tool_calls")
                    {
                        if (doc.RootElement.TryGetProperty("toolCalls", out var tcArray))
                            pendingToolCalls = JsonSerializer.Deserialize<List<LlmToolCall>>(tcArray.GetRawText(), JsonOptions);
                    }
                    else
                    {
                        if (typeStr == "thinking") { thinkingSb.Append(text); await sink.OnThinkingAsync(text); }
                        else { contentSb.Append(text); await sink.OnContentAsync(text); }
                    }
                    parsed = true;
                }
            }
            catch { /* 非结构化 JSON，走标签解析 */ }

            if (parsed) continue;

            // <thinking> 标签解析（简化版，与 ChatStreamProcessor 行为一致）
            await ProcessTagChunkAsync(delta, sink, contentSb, thinkingSb, state);
        }

        return (contentSb.ToString(), thinkingSb.ToString(), pendingToolCalls);
    }

    private class ThinkingTagState
    {
        public bool InThinking;
        public string TagBuffer = "";
    }

    private static async Task ProcessTagChunkAsync(
        string delta,
        IAgentLoopSink sink,
        StringBuilder contentSb,
        StringBuilder thinkingSb,
        ThinkingTagState state)
    {
        var raw = state.TagBuffer + delta;
        state.TagBuffer = "";

        while (raw.Length > 0)
        {
            if (!state.InThinking)
            {
                var openIdx = raw.IndexOf("<thinking>", StringComparison.OrdinalIgnoreCase);
                if (openIdx >= 0)
                {
                    if (openIdx > 0)
                    {
                        var c = raw[..openIdx];
                        contentSb.Append(c);
                        await sink.OnContentAsync(c);
                    }
                    state.InThinking = true;
                    raw = raw[(openIdx + "<thinking>".Length)..];
                }
                else
                {
                    // 检查是否是 <thinking> 的部分前缀
                    var partial = false;
                    for (int k = 1; k < raw.Length && k <= "<thinking>".Length; k++)
                    {
                        if ("<thinking>".StartsWith(raw[^k..], StringComparison.OrdinalIgnoreCase))
                        {
                            if (k < raw.Length)
                            {
                                var c = raw[..^k];
                                contentSb.Append(c);
                                await sink.OnContentAsync(c);
                            }
                            state.TagBuffer = raw[^k..];
                            partial = true;
                            break;
                        }
                    }
                    if (!partial)
                    {
                        contentSb.Append(raw);
                        await sink.OnContentAsync(raw);
                    }
                    raw = "";
                }
            }
            else
            {
                var closeIdx = raw.IndexOf("</thinking>", StringComparison.OrdinalIgnoreCase);
                if (closeIdx >= 0)
                {
                    var t = raw[..closeIdx];
                    if (!string.IsNullOrEmpty(t))
                    {
                        thinkingSb.Append(t);
                        await sink.OnThinkingAsync(t);
                    }
                    state.InThinking = false;
                    raw = raw[(closeIdx + "</thinking>".Length)..];
                }
                else
                {
                    var partial = false;
                    for (int k = 1; k < raw.Length && k <= "</thinking>".Length; k++)
                    {
                        if ("</thinking>".StartsWith(raw[^k..], StringComparison.OrdinalIgnoreCase))
                        {
                            if (k < raw.Length)
                            {
                                var t = raw[..^k];
                                thinkingSb.Append(t);
                                await sink.OnThinkingAsync(t);
                            }
                            state.TagBuffer = raw[^k..];
                            partial = true;
                            break;
                        }
                    }
                    if (!partial)
                    {
                        thinkingSb.Append(raw);
                        await sink.OnThinkingAsync(raw);
                    }
                    raw = "";
                }
            }
        }
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
