using Hetu.Core.Interfaces;
using Hetu.Core.Services.AgentFramework;
using Hetu.Core.Services.Tools;
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
    /// <summary>达到迭代上限后已进行无工具收尾</summary>
    public bool IterationLimitReached { get; set; }
    /// <summary>自动续跑的次数（迭代上限用尽后继续执行，而不是直接收尾）</summary>
    public int ContinuationCount { get; set; }
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
    /// <summary>
    /// 模型上下文窗口（token）。上下文硬上限与续跑锚点阈值都由它推导；
    /// 为空时用 <see cref="DefaultContextWindowTokens"/> 兜底。
    /// </summary>
    public int? ContextWindowTokens { get; set; }

    /// <summary>迭代上限用尽后允许自动续跑的次数（每段重新计 MaxIterations）</summary>
    public int MaxContinuations { get; set; } = 1;
    /// <summary>Provider 瞬时失败的额外重试次数（只在尚未产出任何内容时生效）</summary>
    public int ProviderMaxRetries { get; set; } = 2;
    /// <summary>Provider 重试的基础退避毫秒（逐次线性递增）</summary>
    public int ProviderRetryDelayMs { get; set; } = 400;
    /// <summary>单个工具的默认执行超时（工具自身 Timeout 优先）</summary>
    public TimeSpan ToolTimeout { get; set; } = TimeSpan.FromMinutes(10);
    public string? ReasoningEffort { get; set; }
    public int? ReasoningBudgetTokens { get; set; }
    public int? MaxTokens { get; set; }
    public double? Temperature { get; set; }
    public Dictionary<string, ToolApprovalMode> ToolApprovals { get; set; } = new();
    public string SessionId { get; set; } = "";
    /// <summary>用量日志的来源标记（chat / work / kanban / workflow），由调用端指定</summary>
    public string UsageSource { get; set; } = LlmUsageSources.Chat;
    /// <summary>用量日志的业务引用（话题 / 会话 / 任务 / 工作流运行 ID）</summary>
    public Guid? UsageRefId { get; set; }
    /// <summary>用量日志的请求类型：主 Agent 用 agent，嵌套子 Agent 用 subagent</summary>
    public string UsageRequestKind { get; set; } = LlmUsageRequestKinds.Agent;
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
    /// <summary>后台场景的 plan 决策器；为空时走交互式 SSE 等待</summary>
    public Func<LlmToolCall, Task<PlanDecision>>? PlanHandler { get; set; }
    /// <summary>逐次工具决策（权限模式 / 项目规则）。实时解析当前档位，会话中切换配置立即生效</summary>
    public Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? DecideToolCall { get; set; }
    /// <summary>工作项目作用域：非空时 work_* 工具在该项目目录（或 SSH 远端）内执行</summary>
    public WorkToolScope? WorkScope { get; set; }
    /// <summary>是否启用工具调用（关闭时即使有工具也不执行，直接结束）</summary>
    public bool EnableTools { get; set; } = true;
    /// <summary>
    /// 常驻声明给模型的工具名（其余工具只在系统提示里列名，模型用 load_tools 按需加载 schema）。
    /// 为空表示全部工具都直接声明（保持原行为）。
    /// </summary>
    public IReadOnlyList<string>? CoreToolNames { get; set; }

    /// <summary>
    /// 运行中引导的取件回调：每次迭代开始前调用一次，返回的文本作为「运行中引导」追加进上下文。
    /// 由各端的 <see cref="AgentSteeringHub"/> 提供，没有引导时返回空集合。
    /// </summary>
    public Func<IReadOnlyList<string>>? DrainSteering { get; set; }

    /// <summary>
    /// 退出时保留运行时工具（MCP 适配器）。嵌套运行（如 work_task 子 Agent）必须置 true：
    /// ToolRegistry 是作用域实例，清空会把外层同批次后续调用还要用的工具一起清掉。
    /// </summary>
    public bool PreserveRuntimeTools { get; set; }
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
    /// <summary>运行中引导被注入当前循环（端上提示用户已生效）</summary>
    Task OnSteeringAsync(string text) => Task.CompletedTask;
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
    /// <summary>单条工具结果产生后：可立即落库，避免后续交互等待阻塞整批持久化</summary>
    Task AfterToolResultAsync(AgentToolExecution result) => Task.CompletedTask;
    /// <summary>工具执行后：可记录文件变更、落库工具结果</summary>
    Task AfterToolResultsAsync(IReadOnlyList<AgentToolExecution> results) => Task.CompletedTask;
}

/// <summary>
/// Agent Loop 兼容入口：保留 Hetu 的请求、事件与持久化契约，内部执行委托给 Microsoft Agent Framework。
/// </summary>
public class AgentLoopService
{
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly ToolRegistry _toolRegistry;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<AgentLoopService> _logger;
    private readonly ILocalizer _localizer;
    private readonly MafAgentRunner _mafAgentRunner;

    public AgentLoopService(
        ILLMProviderFactory llmProviderFactory,
        ToolRegistry toolRegistry,
        IUnitOfWork unitOfWork,
        ILogger<AgentLoopService> logger,
        ILocalizer localizer,
        MafAgentRunner mafAgentRunner)
    {
        _llmProviderFactory = llmProviderFactory;
        _toolRegistry = toolRegistry;
        _unitOfWork = unitOfWork;
        _logger = logger;
        _localizer = localizer;
        _mafAgentRunner = mafAgentRunner;
    }

    /// <summary>
    /// 异步加载指定 MCP 服务器的工具并注册为运行时工具，返回适配后的工具名列表。
    /// 失败的服务器会被跳过并记录日志。
    /// </summary>
    public async Task<List<string>> LoadMcpToolsAsync(List<Guid> mcpServerIds, CancellationToken ct)
    {
        var names = new List<string>();
        if (mcpServerIds is null || mcpServerIds.Count == 0) return names;

        var servers = (await _unitOfWork.McpServers.FindAsync(
            s => mcpServerIds.Contains(s.Id), ct)).ToDictionary(s => s.Id);
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

    /// <summary>执行 Agent Loop，返回最终内容、工具调用历史、累计用量与流水。</summary>
    public async Task<AgentLoopResult> RunAsync(AgentLoopRequest request, CancellationToken ct)
    {
        ILLMProvider? provider;
        if (request.ModelId.HasValue)
        {
            provider = await _llmProviderFactory.CreateProviderAsync(request.ModelId.Value, ct);
        }
        else
        {
            provider = await _llmProviderFactory.CreateChatProviderAsync(ct);
        }
        if (provider == null)
            throw new InvalidOperationException(_localizer.T("model.noModelConfigured"));

        var mcpToolNames = await LoadMcpToolsAsync(request.McpServerIds, ct);
        try
        {
            var result = await _mafAgentRunner.RunAsync(request, provider, mcpToolNames, ct);
            if (request.ModelId.HasValue) result.ModelId = request.ModelId.Value.ToString();
            return result;
        }
        finally
        {
            if (!request.PreserveRuntimeTools) _toolRegistry.ClearRuntimeTools();
        }
    }

}
