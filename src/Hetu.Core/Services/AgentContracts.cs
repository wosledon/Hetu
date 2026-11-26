using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;

namespace Hetu.Core.Services;

/// <summary>控制器需要的模型信息；不携带 API Key，也不创建 Provider。</summary>
public sealed record AgentModelInfo(Guid ModelId, string ProviderType, bool SupportsVision);

/// <summary>Agent 运行结果。</summary>
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
    /// <summary>达到迭代上限后已进行无工具收尾</summary>
    public bool IterationLimitReached { get; set; }
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
    public bool IsError { get; init; }
}

/// <summary>流水片段。Kind：text | thought | tool。</summary>
public class AgentTimelineSegment
{
    public string Kind { get; set; } = "text";
    public string? Content { get; set; }
    public string? Name { get; set; }
    public string? Arguments { get; set; }
    public string? Result { get; set; }
    public bool IsError { get; set; }
}

/// <summary>Agent 执行请求。</summary>
public class AgentLoopRequest
{
    public Guid? ModelId { get; set; }
    public string SystemPrompt { get; set; } = string.Empty;
    public List<LlmChatMessage> Messages { get; set; } = new();
    public List<string> ToolNames { get; set; } = new();
    public List<Guid> McpServerIds { get; set; } = new();
    public int MaxIterations { get; set; } = 15;
    public int MaxToolCallsPerTurn { get; set; } = 5;
    public int? ContextWindowTokens { get; set; }
    public TimeSpan ToolTimeout { get; set; } = TimeSpan.FromMinutes(10);
    public string? ReasoningEffort { get; set; }
    public int? ReasoningBudgetTokens { get; set; }
    public int? MaxTokens { get; set; }
    public double? Temperature { get; set; }
    public Dictionary<string, ToolApprovalMode> ToolApprovals { get; set; } = new();
    public string SessionId { get; set; } = "";
    public string UsageSource { get; set; } = LlmUsageSources.Chat;
    public Guid? UsageRefId { get; set; }
    public string UsageRequestKind { get; set; } = LlmUsageRequestKinds.Agent;
    public IAgentLoopSink? Sink { get; set; }
    public IAgentLoopHooks? Hooks { get; set; }
    public bool CompressHistory { get; set; } = true;
    public Func<LlmToolCall, Task<string>>? QuestionHandler { get; set; }
    public Func<LlmToolCall, Task<PlanDecision>>? PlanHandler { get; set; }
    public Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? DecideToolCall { get; set; }
    public WorkToolScope? WorkScope { get; set; }
    public bool EnableTools { get; set; } = true;
    public IReadOnlyList<string>? CoreToolNames { get; set; }
    public Func<IReadOnlyList<string>>? DrainSteering { get; set; }
    public bool PreserveRuntimeTools { get; set; }
}

/// <summary>Agent 事件接收器。</summary>
public interface IAgentLoopSink
{
    Task OnContentAsync(string text) => Task.CompletedTask;
    Task OnThinkingAsync(string text) => Task.CompletedTask;
    Task OnToolCallAsync(LlmToolCall toolCall) => Task.CompletedTask;
    Task OnToolResultAsync(string toolCallId, string content, bool isError) => Task.CompletedTask;
    Task OnDebugAsync(string text) => Task.CompletedTask;
    Task OnErrorAsync(string message) => Task.CompletedTask;
    Task OnEventAsync(object payload) => Task.CompletedTask;
    Task OnUsageAsync(LlmUsage usage) => Task.CompletedTask;
    Task OnSteeringAsync(string text) => Task.CompletedTask;
}

/// <summary>执行过程钩子。</summary>
public interface IAgentLoopHooks
{
    Task OnIterationAsync(int iteration, string content, string thinking, LlmUsage? usage) => Task.CompletedTask;
    Task BeforeToolCallsAsync(IReadOnlyList<LlmToolCall> toolCalls) => Task.CompletedTask;
    Task AfterToolResultAsync(AgentToolExecution result) => Task.CompletedTask;
    Task AfterToolResultsAsync(IReadOnlyList<AgentToolExecution> results) => Task.CompletedTask;
}