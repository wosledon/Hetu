using System.Collections.Concurrent;
using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>
/// Session-scoped dictionary that isolates state per session ID.
/// Thread-safe, designed for singletons that need per-session state without
/// cross-session interference.
/// </summary>
public class Session<T> where T : class, new()
{
    private readonly ConcurrentDictionary<string, T> _sessions = new();

    public T GetOrCreate(string sessionId) => _sessions.GetOrAdd(sessionId, _ => new T());

    public bool TryGet(string sessionId, out T value)
    {
        var ok = _sessions.TryGetValue(sessionId, out var v);
        value = v!;
        return ok;
    }

    public bool TryRemove(string sessionId, out T value)
    {
        var ok = _sessions.TryRemove(sessionId, out var v);
        value = v!;
        return ok;
    }
}

/// <summary>交互型工具：todo / ask_question / plan。</summary>
/// 由 Agent Loop 拦截处理，不进入通用执行与权限审批流程，SSE 事件也不显示为普通工具调用。
public static class InteractiveTools
{
    public const string Todo = "todo";
    public const string AskQuestion = "ask_question";
    public const string Plan = "plan";

    public static bool IsInteractive(string? name) =>
        name is Todo or AskQuestion or Plan;
}

/// <summary>Per-session state for pending interactive tool calls.</summary>
public class SessionPendingState
{
    public ConcurrentDictionary<string, TaskCompletionSource<string>> Questions = new();
    public ConcurrentDictionary<string, string> QuestionPayloads = new();
    public ConcurrentDictionary<string, TaskCompletionSource<bool>> Approvals = new();
    public ConcurrentDictionary<string, TaskCompletionSource<PlanDecision>> Plans = new();
    public ConcurrentDictionary<string, string> PlanPayloads = new();
}

/// <summary>后端仍在等待的交互事件，供刷新后的前端直接恢复</summary>
public record PendingInteraction(string ToolCallId, string Type, string Data);

/// <summary>用户对计划工具的决策：批准 / 驳回（可附修改意见）。</summary>
public record PlanDecision(bool Approved, string Feedback)
{
    /// <summary>回传给模型的自然语言结论（文案走 i18n，随界面语言切换）</summary>
    public string ToToolResult(ILocalizer localizer) => Approved
        ? localizer.T("toolExec.planApproved")
        : string.IsNullOrWhiteSpace(Feedback)
            ? localizer.T("toolExec.planRejectedNoReason")
            : localizer.T("toolExec.planRejectedWithFeedback", Feedback);
}

/// <summary>
/// Orchestrates tool execution during the Agent Loop, including:
/// approval flow, ask_question, todo state management, and generic tool execution.
/// Registered as Singleton. Uses Session&lt;SessionPendingState&gt; to isolate
/// ask/answer and approve/deny across concurrent conversations.
/// </summary>
public class ToolExecutionService
{
    private readonly ILogger<ToolExecutionService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILocalizer _localizer;

    private readonly Session<SessionPendingState> _sessions = new();

    public ToolExecutionService(ILogger<ToolExecutionService> logger, IServiceScopeFactory scopeFactory, ILocalizer localizer)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _localizer = localizer;
    }

    public IReadOnlyList<PendingInteraction> GetPendingInteractions(string sessionId)
    {
        if (!_sessions.TryGet(sessionId, out var state)) return [];
        return state.QuestionPayloads.Select(p => new PendingInteraction(p.Key, "question", p.Value))
            .Concat(state.PlanPayloads.Select(p => new PendingInteraction(p.Key, "plan", p.Value)))
            .ToList();
    }

    /// <summary>Submit an answer to a pending ask_question in the given session.</summary>
    public bool TrySetAnswer(string sessionId, string toolCallId, string answer)
    {
        if (_sessions.TryGet(sessionId, out var state)
            && state.Questions.TryRemove(toolCallId, out var tcs))
        {
            state.QuestionPayloads.TryRemove(toolCallId, out _);
            tcs.TrySetResult(answer);
            return true;
        }
        return false;
    }

    /// <summary>Submit an approval decision for a pending tool in the given session.</summary>
    public bool TrySetApproval(string sessionId, string toolCallId, bool approved)
    {
        if (_sessions.TryGet(sessionId, out var state)
            && state.Approvals.TryRemove(toolCallId, out var tcs))
        {
            tcs.TrySetResult(approved);
            return true;
        }
        return false;
    }

    public TaskCompletionSource<bool> RegisterApproval(string sessionId, string toolCallId)
    {
        var state = _sessions.GetOrCreate(sessionId);
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        state.Approvals[toolCallId] = tcs;
        return tcs;
    }

    public void RemoveApproval(string sessionId, string toolCallId)
    {
        if (_sessions.TryGet(sessionId, out var state))
            state.Approvals.TryRemove(toolCallId, out _);
    }

    /// <summary>Submit a decision (approve/reject with optional feedback) for a pending plan in the given session.</summary>
    public bool TrySetPlanDecision(string sessionId, string toolCallId, bool approved, string feedback)
    {
        if (_sessions.TryGet(sessionId, out var state)
            && state.Plans.TryRemove(toolCallId, out var tcs))
        {
            state.PlanPayloads.TryRemove(toolCallId, out _);
            tcs.TrySetResult(new PlanDecision(approved, feedback));
            return true;
        }
        return false;
    }

    /// <summary>运行中引导到达时解除 plan/question 等待，让循环到下一轮接收新指示；审批仍必须由用户决定</summary>
    public int ResolvePendingInteractions(string sessionId)
    {
        if (!_sessions.TryGet(sessionId, out var state)) return 0;
        var resolved = 0;
        var guidance = _localizer.T("toolExec.steered");
        foreach (var id in state.Questions.Keys.ToList())
        {
            if (!state.Questions.TryRemove(id, out var tcs) || !tcs.TrySetResult(guidance)) continue;
            state.QuestionPayloads.TryRemove(id, out _);
            resolved++;
        }
        foreach (var id in state.Plans.Keys.ToList())
        {
            if (!state.Plans.TryRemove(id, out var tcs) || !tcs.TrySetResult(new PlanDecision(false, guidance))) continue;
            state.PlanPayloads.TryRemove(id, out _);
            resolved++;
        }
        return resolved;
    }

    /// <summary>
    /// 权限模式在会话进行中被切换时，裁决该会话仍在等待的审批：
    /// 切成 auto / bypass（「无需确认」）按批准处理，用户不该再被审批弹窗卡住；
    /// 切成 plan / readonly（强约束）按拒绝处理，写操作不再放行。
    /// 返回实际裁决的条数；没有正在运行的循环时为 0。
    /// </summary>
    public int ResolvePendingApprovals(string sessionId, bool approved)
    {
        if (!_sessions.TryGet(sessionId, out var state)) return 0;
        var resolved = 0;
        foreach (var toolCallId in state.Approvals.Keys.ToList())
        {
            if (state.Approvals.TryRemove(toolCallId, out var tcs) && tcs.TrySetResult(approved)) resolved++;
        }
        return resolved;
    }

    /// <summary>
    /// Execute a list of tool calls within a session, handling approval, ask_question, and todo.
    /// Returns the tool results so the caller can add them to the LLM chat history.
    /// </summary>
    /// <param name="decideToolCall">
    /// 可选的逐次决策回调（权限模式 / 项目规则）。返回不允许时该工具不执行，
    /// 直接把拒绝原因作为工具结果回传模型。
    /// </param>
    /// <param name="workScope">
    /// 可选的工作项目作用域。工具在新作用域内执行，需显式传递，否则 work_* 文件工具取不到根目录与运行时工具。
    /// </param>
    /// <param name="questionHandler">
    /// 可选的提问处理器。非空时 ask_question 不走 SSE 会话等待（无人应答会 5 分钟超时跳过），
    /// 改由该回调立即裁决——如后台任务可直接抛出异常中断执行并交由调用方决定是否阻塞等待用户。
    /// </param>
    public async Task<List<(string toolCallId, string content, bool isError)>> ExecuteToolCallsAsync(
        string sessionId,
        List<LlmToolCall> toolCalls,
        Dictionary<string, ToolApprovalMode> approvalOverrides,
        List<SessionTodo> sessionTodos,
        Func<string, Task> writeEventAsync,
        Func<object, Task> writeJsonAsync,
        CancellationToken cancellationToken,
        Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? decideToolCall = null,
        WorkToolScope? workScope = null,
        Func<LlmToolCall, Task<string>>? questionHandler = null,
        Func<LlmToolCall, Task<PlanDecision>>? planHandler = null,
        Func<(string toolCallId, string content, bool isError), Task>? onToolResult = null,
        TimeSpan? defaultToolTimeout = null,
        bool approvalAlreadyHandled = false)
    {
        var results = new List<(string toolCallId, string content, bool isError)>(toolCalls.Count);
        foreach (var call in toolCalls)
        {
            var result = await ExecuteToolCallAsync(
                sessionId, call, approvalOverrides, sessionTodos, writeJsonAsync, cancellationToken,
                decideToolCall, workScope, questionHandler, planHandler, defaultToolTimeout, approvalAlreadyHandled);
            results.Add((call.Id, result.content, result.isError));
            if (onToolResult != null) await onToolResult(results[^1]);
        }
        return results;
    }

    private async Task<(string content, bool isError)> ExecuteToolCallAsync(
        string sessionId,
        LlmToolCall toolCall,
        Dictionary<string, ToolApprovalMode> approvalOverrides,
        List<SessionTodo> sessionTodos,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct,
        Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? decideToolCall,
        WorkToolScope? workScope,
        Func<LlmToolCall, Task<string>>? questionHandler,
        Func<LlmToolCall, Task<PlanDecision>>? planHandler,
        TimeSpan? defaultToolTimeout,
        bool approvalAlreadyHandled)
    {
        var state = _sessions.GetOrCreate(sessionId);
        var isSilentTool = InteractiveTools.IsInteractive(toolCall.Name);
        await writeJsonAsync(new
        {
            type = "tool_call",
            id = toolCall.Id,
            name = toolCall.Name,
            arguments = toolCall.Arguments,
            hidden = isSilentTool,
        });

        await using var scope = _scopeFactory.CreateAsyncScope();
        var workContext = scope.ServiceProvider.GetRequiredService<WorkToolContext>();
        if (workScope != null)
        {
            workContext.ProjectRoot = workScope.ProjectRoot;
            workContext.ProjectId = workScope.ProjectId;
            workContext.ModelId = workScope.ModelId;
            workContext.DiagnosticsCommand = workScope.DiagnosticsCommand;
        }
        workContext.WriteEventAsync = writeJsonAsync;
        workContext.Runner = workScope?.Runner;
        var toolRegistry = scope.ServiceProvider.GetRequiredService<ToolRegistry>();
        if (workScope?.RuntimeTools != null)
        {
            foreach (var runtimeTool in workScope.RuntimeTools)
                toolRegistry.AddRuntimeTool(runtimeTool);
        }

        var executor = toolRegistry.GetExecutor(toolCall.Name);
        var explicitOverride = approvalOverrides.TryGetValue(toolCall.Name, out var byName)
            ? byName
            : approvalOverrides.TryGetValue("*", out var byWildcard)
                ? byWildcard
                : (ToolApprovalMode?)null;
        var approval = explicitOverride ?? executor?.DefaultApproval ?? ToolApprovalMode.Auto;
        async Task<(string content, bool isError)> ReturnAsync(string content, bool isError)
        {
            await writeJsonAsync(new
            {
                type = "tool_result",
                id = toolCall.Id,
                name = toolCall.Name,
                content,
                isError,
                collapsed = approval == ToolApprovalMode.Bypass,
                hidden = isSilentTool,
            });
            return (content, isError);
        }
        if (decideToolCall != null && !isSilentTool)
        {
            var decision = await decideToolCall(toolCall, approval);
            if (!decision.Allowed)
                return await ReturnAsync(decision.DenyMessage ?? _localizer.T("toolExec.denied", toolCall.Name), true);
            approval = explicitOverride ?? decision.Mode;
        }
        if (executor == null && !isSilentTool)
            return await ReturnAsync(_localizer.T("toolExec.notFound", toolCall.Name), true);

        var result = approval == ToolApprovalMode.Ask && !isSilentTool && !approvalAlreadyHandled
            ? await ExecuteWithApprovalAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, ct, defaultToolTimeout)
            : await ExecuteSingleToolAsync(state, toolCall, executor!, sessionTodos, writeJsonAsync, ct, questionHandler, planHandler, defaultToolTimeout);
        await writeJsonAsync(new
        {
            type = "tool_result",
            id = toolCall.Id,
            name = toolCall.Name,
            content = result.content,
            isError = result.isError,
            collapsed = approval == ToolApprovalMode.Bypass,
            hidden = isSilentTool,
        });
        return result;
    }

    private async Task<(string content, bool isError)> ExecuteWithApprovalAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        IToolExecutor? executor,
        List<SessionTodo> sessionTodos,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct,
        TimeSpan? defaultToolTimeout = null)
    {
        var approvalTcs = new TaskCompletionSource<bool>();
        state.Approvals[toolCall.Id] = approvalTcs;
        await writeJsonAsync(new { type = "approval_request", id = toolCall.Id, name = toolCall.Name, arguments = toolCall.Arguments });

        bool approved;
        try
        {
            approved = await approvalTcs.Task.WaitAsync(TimeSpan.FromMinutes(5), ct);
        }
        catch (TimeoutException)
        {
            return (_localizer.T("toolExec.approvalTimeout", toolCall.Name), true);
        }
        finally
        {
            state.Approvals.TryRemove(toolCall.Id, out _);
        }

        if (!approved)
            return (_localizer.T("toolExec.userDenied", toolCall.Name), true);

        if (executor != null)
            return await ExecuteSingleToolAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, ct, defaultToolTimeout: defaultToolTimeout);

        return (_localizer.T("toolExec.notFound", toolCall.Name), true);
    }

    private async Task<(string content, bool isError)> ExecuteSingleToolAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        IToolExecutor executor,
        List<SessionTodo> sessionTodos,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct,
        Func<LlmToolCall, Task<string>>? questionHandler = null,
        Func<LlmToolCall, Task<PlanDecision>>? planHandler = null,
        TimeSpan? defaultToolTimeout = null)
    {
        // 提问处理器的裁决异常（如后台任务阻塞等待用户回答）必须中断执行，
        // 不能被下面的通用 catch 降级为一条工具错误结果
        if (toolCall.Name == InteractiveTools.AskQuestion && questionHandler != null)
            return await HandleAskQuestionAsync(state, toolCall, writeJsonAsync, ct, questionHandler);

        try
        {
            if (toolCall.Name == InteractiveTools.AskQuestion)
                return await HandleAskQuestionAsync(state, toolCall, writeJsonAsync, ct, null);

            if (toolCall.Name == InteractiveTools.Todo)
                return await HandleTodoAsync(toolCall, sessionTodos, writeJsonAsync, ct);

            if (toolCall.Name == InteractiveTools.Plan)
                return await HandlePlanAsync(state, toolCall, writeJsonAsync, ct, planHandler);

            var timeout = executor.Timeout ?? defaultToolTimeout;
            if (timeout is { } limit && limit > TimeSpan.Zero)
            {
                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeoutCts.CancelAfter(limit);
                try
                {
                    var timed = await executor.ExecuteAsync(toolCall.Arguments, timeoutCts.Token);
                    return (timed.Content, timed.IsError);
                }
                catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !ct.IsCancellationRequested)
                {
                    return (_localizer.T("toolExec.timeout", toolCall.Name, limit.TotalSeconds), true);
                }
            }

            var result = await executor.ExecuteAsync(toolCall.Arguments, ct);
            return (result.Content, result.IsError);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            return (_localizer.T("toolExec.failed", ex.Message), true);
        }
    }

    private async Task<(string content, bool isError)> HandleAskQuestionAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct,
        Func<LlmToolCall, Task<string>>? questionHandler = null)
    {
        _logger.LogInformation("[ToolExec] ask_question pending toolCallId={ToolCallId}", toolCall.Id);

        // 后台执行（无人可通过 SSE 应答）时由调用方裁决，例如直接中断执行转人工
        if (questionHandler != null)
            return (await questionHandler(toolCall), false);

        var tcs = new TaskCompletionSource<string>();
        state.Questions[toolCall.Id] = tcs;
        state.QuestionPayloads[toolCall.Id] = toolCall.Arguments;
        await writeJsonAsync(new { type = "question", toolCallId = toolCall.Id, data = toolCall.Arguments });

        try
        {
            var answer = await tcs.Task.WaitAsync(TimeSpan.FromMinutes(5), ct);
            return (answer, false);
        }
        catch (TimeoutException)
        {
            return (_localizer.T("toolExec.questionTimeout"), false);
        }
        finally
        {
            state.QuestionPayloads.TryRemove(toolCall.Id, out _);
            state.Questions.TryRemove(toolCall.Id, out _);
        }
    }

    private async Task<(string content, bool isError)> HandlePlanAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct,
        Func<LlmToolCall, Task<PlanDecision>>? planHandler = null)
    {
        _logger.LogInformation("[ToolExec] plan pending toolCallId={ToolCallId}", toolCall.Id);
        if (planHandler != null)
        {
            await writeJsonAsync(new { type = "plan", toolCallId = toolCall.Id, data = toolCall.Arguments });
            var backgroundDecision = await planHandler(toolCall);
            return (backgroundDecision.ToToolResult(_localizer), false);
        }

        var tcs = new TaskCompletionSource<PlanDecision>();
        state.Plans[toolCall.Id] = tcs;
        state.PlanPayloads[toolCall.Id] = toolCall.Arguments;
        await writeJsonAsync(new { type = "plan", toolCallId = toolCall.Id, data = toolCall.Arguments });

        try
        {
            var decision = await tcs.Task.WaitAsync(TimeSpan.FromMinutes(5), ct);
            return (decision.ToToolResult(_localizer), false);
        }
        catch (TimeoutException)
        {
            return (_localizer.T("toolExec.planTimeout"), false);
        }
        finally
        {
            state.PlanPayloads.TryRemove(toolCall.Id, out _);
            state.Plans.TryRemove(toolCall.Id, out _);
        }
    }

    private async Task<(string content, bool isError)> HandleTodoAsync(
        LlmToolCall toolCall,
        List<SessionTodo> sessionTodos,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct)
    {
        string todoAction = "list";
        string todoId = "";
        string todoTitle = "";
        string todoDescription = "";
        string todoStatus = "";

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(toolCall.Arguments);
            var root = doc.RootElement;
            if (root.TryGetProperty("action", out var aEl)) todoAction = aEl.GetString() ?? "list";
            if (root.TryGetProperty("id", out var idEl) && idEl.ValueKind == System.Text.Json.JsonValueKind.String)
                todoId = idEl.GetString() ?? "";
            if (root.TryGetProperty("title", out var tEl)) todoTitle = tEl.GetString() ?? "";
            if (root.TryGetProperty("description", out var dEl)) todoDescription = dEl.GetString() ?? "";
            if (root.TryGetProperty("status", out var sEl)) todoStatus = sEl.GetString() ?? "";
        }
        catch { }

        if (todoAction == "create" && !string.IsNullOrEmpty(todoTitle))
        {
            if (string.IsNullOrEmpty(todoId)) todoId = $"step-{sessionTodos.Count + 1}";
            if (string.IsNullOrEmpty(todoStatus)) todoStatus = "not-started";
            if (!sessionTodos.Any(t => t.Id == todoId))
                sessionTodos.Add(new SessionTodo { Id = todoId, Title = todoTitle, Description = todoDescription, Status = todoStatus });
        }
        else if (todoAction == "update" || todoAction == "complete")
        {
            var existing = !string.IsNullOrEmpty(todoId)
                ? sessionTodos.FirstOrDefault(t => t.Id == todoId)
                : null;
            if (existing == null && !string.IsNullOrEmpty(todoTitle))
                existing = sessionTodos.FirstOrDefault(t => string.Equals(t.Title, todoTitle, StringComparison.OrdinalIgnoreCase));
            if (existing == null && (!string.IsNullOrEmpty(todoId) || !string.IsNullOrEmpty(todoTitle)))
                return (_localizer.T("toolExec.todoNotFound", !string.IsNullOrEmpty(todoId) ? todoId : todoTitle), true);
            if (existing == null)
                existing = sessionTodos.FirstOrDefault(t => t.Status != "completed");

            if (existing != null)
            {
                existing.Status = todoAction == "complete" ? "completed" : string.IsNullOrEmpty(todoStatus) ? "in-progress" : todoStatus;
                if (!string.IsNullOrEmpty(todoDescription)) existing.Description = todoDescription;
                todoStatus = existing.Status;
                todoId = existing.Id;
            }
        }

        await writeJsonAsync(new
        {
            type = "todo",
            data = new
            {
                action = todoAction,
                id = todoId,
                title = todoTitle,
                description = todoDescription,
                status = todoStatus,
                todos = sessionTodos.Select(t => new { t.Id, t.Title, t.Description, t.Status }).ToList()
            }
        });

        if (sessionTodos.Count == 0)
            return (_localizer.T("toolExec.planEmpty"), false);

        var sb = new StringBuilder();
        sb.AppendLine(_localizer.T("toolExec.planHeader", sessionTodos.Count));
        foreach (var t in sessionTodos)
        {
            var mark = t.Status switch
            {
                "completed" => _localizer.T("toolExec.statusDone"),
                "in-progress" => _localizer.T("toolExec.statusInProgress"),
                _ => _localizer.T("toolExec.statusTodo")
            };
            sb.AppendLine($"  - id={t.Id} {mark} {t.Title}");
        }

        var next = sessionTodos.FirstOrDefault(t => t.Status != "completed");
        if (next != null)
        {
            sb.AppendLine();
            sb.AppendLine(_localizer.T("toolExec.planNext", next.Title, next.Id));
        }
        else
        {
            sb.AppendLine();
            sb.AppendLine(_localizer.T("toolExec.planAllDone"));
        }

        return (sb.ToString(), false);
    }
}

/// <summary>Per-stream todo item tracked by the Agent Loop.</summary>
public class SessionTodo
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Status { get; set; } = "not-started";
}
