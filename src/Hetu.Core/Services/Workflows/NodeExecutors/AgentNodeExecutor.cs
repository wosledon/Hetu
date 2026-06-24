using System.Collections.Concurrent;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Agent 节点：node.AgentId 引用智能体页面维护的 PromptPreset（仅取 Content 作系统提示词）,
/// modelId/toolNames/mcpServerIds/toolApprovals/迭代次数等执行参数全部来自节点 config JSON。
/// 调用 AgentLoopService 执行 LLM+工具循环，输出 LLM 最终内容。
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
            return new NodeResult { Error = "Agent 节点未配置智能体" };

        var preset = await _unitOfWork.PromptPresets.GetByIdAsync(node.AgentId.Value, ct);
        if (preset == null)
            return new NodeResult { Error = $"智能体 {node.AgentId} 不存在" };

        // 解析节点配置
        var config = ParseConfig(node.Config);

        // 自动接棒：从入边收集上游节点输出作为输入
        var upstreamEdges = ctx.Edges.Where(e => e.Target == node.Id).ToList();
        var upstreamOutputs = new List<(string Label, string Output)>();
        foreach (var edge in upstreamEdges)
        {
            var upstreamNode = ctx.Nodes.FirstOrDefault(n => n.Id == edge.Source);
            var label = upstreamNode?.Label ?? edge.Source;
            var output = ctx.GetVariableText($"{edge.Source}.output");
            if (!string.IsNullOrWhiteSpace(output))
                upstreamOutputs.Add((label, output));
        }

        string userInput;
        if (upstreamOutputs.Count == 0)
        {
            userInput = ctx.Input ?? "";
        }
        else if (upstreamOutputs.Count == 1)
        {
            userInput = upstreamOutputs[0].Output;
        }
        else
        {
            userInput = string.Join("\n\n", upstreamOutputs.Select(u => $"[来自 {u.Label}]\n{u.Output}"));
        }

        // 构建 LLM 消息
        var messages = new List<LlmChatMessage>
        {
            new() { Role = "user", Content = userInput }
        };

        // 节点级执行参数（全部来自 node.Config）
        var toolNames = TryGetList<string>(config, "toolNames");
        var mcpServerIds = TryGetList<string>(config, "mcpServerIds").Select(Guid.Parse).ToList();
        var toolApprovals = TryGetDict(config, "toolApprovals")
            .ToDictionary(kv => kv.Key, kv => Enum.TryParse<ToolApprovalMode>(kv.Value, true, out var m) ? m : ToolApprovalMode.Auto);

        var request = new AgentLoopRequest
        {
            ModelId = TryGetGuid(config, "modelId"),
            SystemPrompt = preset.Content,
            Messages = messages,
            ToolNames = toolNames,
            McpServerIds = mcpServerIds,
            MaxIterations = TryGetInt(config, "maxIterations", 15),
            MaxToolCallsPerTurn = TryGetInt(config, "maxToolCallsPerTurn", 5),
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

    private static string? TryGetString(Dictionary<string, object>? config, string key)
        => config != null && config.TryGetValue(key, out var v) && v is JsonElement je
            ? (je.ValueKind == JsonValueKind.String ? je.GetString() : je.GetRawText())
            : null;

    private static Guid? TryGetGuid(Dictionary<string, object>? config, string key)
    {
        var s = TryGetString(config, key);
        return !string.IsNullOrWhiteSpace(s) && Guid.TryParse(s, out var g) ? g : null;
    }

    private static List<T> TryGetList<T>(Dictionary<string, object>? config, string key)
    {
        if (config == null || !config.TryGetValue(key, out var v) || v is not JsonElement je || je.ValueKind != JsonValueKind.Array)
            return new List<T>();
        try { return je.Deserialize<List<T>>(JsonOptions) ?? new List<T>(); }
        catch { return new List<T>(); }
    }

    private static Dictionary<string, string> TryGetDict(Dictionary<string, object>? config, string key)
    {
        if (config == null || !config.TryGetValue(key, out var v) || v is not JsonElement je || je.ValueKind != JsonValueKind.Object)
            return new Dictionary<string, string>();
        try { return je.Deserialize<Dictionary<string, string>>(JsonOptions) ?? new(); }
        catch { return new Dictionary<string, string>(); }
    }

    private static int TryGetInt(Dictionary<string, object>? config, string key, int defaultValue)
    {
        if (config == null || !config.TryGetValue(key, out var v) || v is not JsonElement je) return defaultValue;
        return je.ValueKind == JsonValueKind.Number && je.TryGetInt32(out var i) ? i : defaultValue;
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
