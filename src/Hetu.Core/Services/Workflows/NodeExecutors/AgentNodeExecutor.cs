using System.Collections.Concurrent;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Agent 节点：加载 Agent 实体，用模板解析输入，调用 AgentLoopService 执行 LLM+工具循环，
/// 输出 LLM 最终内容。
/// </summary>
public class AgentNodeExecutor : INodeExecutor
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly AgentLoopService _agentLoopService;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public AgentNodeExecutor(IUnitOfWork unitOfWork, AgentLoopService agentLoopService)
    {
        _unitOfWork = unitOfWork;
        _agentLoopService = agentLoopService;
    }

    public string NodeType => WorkflowNodeTypes.Agent;

    public async Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        if (node.AgentId == null)
            return new NodeResult { Error = "Agent 节点未配置 AgentId" };

        var agent = await _unitOfWork.Agents.GetByIdAsync(node.AgentId.Value, ct);
        if (agent == null)
            return new NodeResult { Error = $"Agent {node.AgentId} 不存在" };
        if (!agent.IsEnabled)
            return new NodeResult { Error = $"Agent {agent.Name} 已禁用" };

        // 解析输入模板
        var config = ParseConfig(node.Config);
        var inputTemplate = config?.TryGetValue("inputTemplate", out var it) == true ? it?.ToString() : null;
        var userInput = TemplateResolver.Resolve(inputTemplate ?? "", ctx);
        if (string.IsNullOrWhiteSpace(userInput))
            userInput = ctx.Input ?? "";

        // 构建 LLM 消息
        var messages = new List<LlmChatMessage>
        {
            new() { Role = "user", Content = userInput }
        };

        // 解析 Agent 配置
        var toolNames = AgentService.DeserializeList(agent.ToolNames);
        var mcpServerIds = AgentService.DeserializeGuidList(agent.McpServerIds);
        var toolApprovals = AgentService.DeserializeDict(agent.ToolApprovals)
            .ToDictionary(kv => kv.Key, kv => Enum.TryParse<ToolApprovalMode>(kv.Value, true, out var m) ? m : ToolApprovalMode.Auto);

        var request = new AgentLoopRequest
        {
            ModelId = agent.ModelId,
            SystemPrompt = agent.SystemPrompt,
            Messages = messages,
            ToolNames = toolNames,
            McpServerIds = mcpServerIds,
            MaxIterations = agent.MaxAgentIterations,
            MaxToolCallsPerTurn = agent.MaxToolCallsPerTurn,
            ToolApprovals = toolApprovals,
            SessionId = $"workflow-{ctx.RunId}-{node.Id}",
            Sink = new CollectingAgentLoopSink()
        };

        var result = await _agentLoopService.RunAsync(request, ct);

        var nodeResult = new NodeResult { Output = result.Content };
        if (!string.IsNullOrEmpty(result.Thinking))
            nodeResult.ExtraVariables["thinking"] = result.Thinking!;
        if (result.ToolCalls.Count > 0)
            nodeResult.ExtraVariables["toolCalls"] = JsonSerializer.Serialize(result.ToolCalls);
        return nodeResult;
    }

    private static Dictionary<string, object>? ParseConfig(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return null;
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(configJson, JsonOptions); }
        catch { return null; }
    }
}

/// <summary>收集 Agent Loop 事件（MVP 实现：静默，可扩展为转发到 SSE）</summary>
internal class CollectingAgentLoopSink : IAgentLoopSink
{
    public StringBuilderLite Content { get; } = new();
    public Task OnContentAsync(string text) { Content.Append(text); return Task.CompletedTask; }
    public Task OnThinkingAsync(string text) => Task.CompletedTask;
    public Task OnToolCallAsync(LlmToolCall toolCall) => Task.CompletedTask;
    public Task OnToolResultAsync(string toolCallId, string content, bool isError) => Task.CompletedTask;
    public Task OnDebugAsync(string text) => Task.CompletedTask;
}

internal class StringBuilderLite
{
    private readonly System.Text.StringBuilder _sb = new();
    public void Append(string s) => _sb.Append(s);
    public override string ToString() => _sb.ToString();
}
