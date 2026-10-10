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
    public ConcurrentDictionary<string, TaskCompletionSource<bool>> Approvals = new();
    public ConcurrentDictionary<string, TaskCompletionSource<PlanDecision>> Plans = new();
}

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

    /// <summary>Submit an answer to a pending ask_question in the given session.</summary>
    public bool TrySetAnswer(string sessionId, string toolCallId, string answer)
    {
        if (_sessions.TryGet(sessionId, out var state)
            && state.Questions.TryRemove(toolCallId, out var tcs))
        {
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

    /// <summary>Submit a decision (approve/reject with optional feedback) for a pending plan in the given session.</summary>
    public bool TrySetPlanDecision(string sessionId, string toolCallId, bool approved, string feedback)
    {
        if (_sessions.TryGet(sessionId, out var state)
            && state.Plans.TryRemove(toolCallId, out var tcs))
        {
            tcs.TrySetResult(new PlanDecision(approved, feedback));
            return true;
        }
        return false;
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
        Func<LlmToolCall, ToolApprovalMode, WorkToolDecision>? decideToolCall = null,
        WorkToolScope? workScope = null,
        Func<LlmToolCall, Task<string>>? questionHandler = null)
    {
        var results = new List<(string toolCallId, string content, bool isError)>();
        var state = _sessions.GetOrCreate(sessionId);

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

        foreach (var toolCall in toolCalls)
        {
            bool isSilentTool = InteractiveTools.IsInteractive(toolCall.Name);

            _logger.LogInformation("[ToolExec] writeJsonAsync tool_call id={Id} name={Name} session={SessionId}", toolCall.Id, toolCall.Name, sessionId);
            await writeJsonAsync(new
            {
                type = "tool_call",
                id = toolCall.Id,
                name = toolCall.Name,
                arguments = toolCall.Arguments,
                hidden = isSilentTool
            });

            var executor = toolRegistry.GetExecutor(toolCall.Name);

            // 优先级：显式逐工具配置 > 策略模式（权限模式 / 项目规则） > 工具自身声明
            ToolApprovalMode? explicitOverride = approvalOverrides.TryGetValue(toolCall.Name, out var byName)
                ? byName
                : approvalOverrides.TryGetValue("*", out var byWildcard)
                    ? byWildcard
                    : null;

            var approval = explicitOverride ?? executor?.DefaultApproval ?? ToolApprovalMode.Auto;

            // 策略只做"否决"与"补默认"：显式配置优先，项目规则仍可否决
            if (decideToolCall != null && !isSilentTool)
            {
                var decision = decideToolCall(toolCall, approval);
                if (!decision.Allowed)
                {
                    var denyMessage = decision.DenyMessage ?? _localizer.T("toolExec.denied", toolCall.Name);
                    await writeJsonAsync(new
                    {
                        type = "tool_result",
                        id = toolCall.Id,
                        name = toolCall.Name,
                        content = denyMessage,
                        isError = true,
                        collapsed = false,
                        hidden = isSilentTool
                    });
                    results.Add((toolCall.Id, denyMessage, true));
                    continue;
                }
                approval = explicitOverride ?? decision.Mode;
            }

            string resultContent;
            bool isError = false;

            if (approval == ToolApprovalMode.Ask && !InteractiveTools.IsInteractive(toolCall.Name))
            {
                (resultContent, isError) = await ExecuteWithApprovalAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, cancellationToken);
            }
            else if (executor != null)
            {
                (resultContent, isError) = await ExecuteSingleToolAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, cancellationToken, questionHandler);
            }
            else
            {
                resultContent = _localizer.T("toolExec.notFound", toolCall.Name);
                isError = true;
            }

            await writeJsonAsync(new
            {
                type = "tool_result",
                id = toolCall.Id,
                name = toolCall.Name,
                content = resultContent,
                isError,
                collapsed = approval == ToolApprovalMode.Bypass,
                hidden = isSilentTool
            });

            results.Add((toolCall.Id, resultContent, isError));
        }

        return results;
    }

    private async Task<(string content, bool isError)> ExecuteWithApprovalAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        IToolExecutor? executor,
        List<SessionTodo> sessionTodos,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct)
    {
        await writeJsonAsync(new { type = "approval_request", id = toolCall.Id, name = toolCall.Name, arguments = toolCall.Arguments });

        var approvalTcs = new TaskCompletionSource<bool>();
        state.Approvals[toolCall.Id] = approvalTcs;

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
            return await ExecuteSingleToolAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, ct);

        return (_localizer.T("toolExec.notFound", toolCall.Name), true);
    }

    private async Task<(string content, bool isError)> ExecuteSingleToolAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        IToolExecutor executor,
        List<SessionTodo> sessionTodos,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct,
        Func<LlmToolCall, Task<string>>? questionHandler = null)
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
                return await HandlePlanAsync(state, toolCall, writeJsonAsync, ct);

            var result = await executor.ExecuteAsync(toolCall.Arguments, ct);
            return (result.Content, result.IsError);
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
        await writeJsonAsync(new { type = "question", toolCallId = toolCall.Id, data = toolCall.Arguments });

        // 后台执行（无人可通过 SSE 应答）时由调用方裁决，例如直接中断执行转人工
        if (questionHandler != null)
            return (await questionHandler(toolCall), false);

        var tcs = new TaskCompletionSource<string>();
        state.Questions[toolCall.Id] = tcs;

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
            state.Questions.TryRemove(toolCall.Id, out _);
        }
    }

    private async Task<(string content, bool isError)> HandlePlanAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct)
    {
        _logger.LogInformation("[ToolExec] plan pending toolCallId={ToolCallId}", toolCall.Id);
        await writeJsonAsync(new { type = "plan", toolCallId = toolCall.Id, data = toolCall.Arguments });

        var tcs = new TaskCompletionSource<PlanDecision>();
        state.Plans[toolCall.Id] = tcs;

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
                sessionTodos.Add(new SessionTodo { Id = todoId, Title = todoTitle, Status = todoStatus });
        }
        else if (todoAction == "update" || todoAction == "complete")
        {
            var existing = !string.IsNullOrEmpty(todoId)
                ? sessionTodos.FirstOrDefault(t => t.Id == todoId)
                : null;
            if (existing == null && !string.IsNullOrEmpty(todoTitle))
                existing = sessionTodos.FirstOrDefault(t => string.Equals(t.Title, todoTitle, StringComparison.OrdinalIgnoreCase));
            if (existing == null)
                existing = sessionTodos.FirstOrDefault(t => t.Status != "completed");

            if (existing != null)
            {
                existing.Status = todoAction == "complete" ? "completed" : todoStatus;
                if (existing.Status == "completed" && string.IsNullOrEmpty(todoStatus))
                    todoStatus = "completed";
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
                todos = sessionTodos.Select(t => new { t.Id, t.Title, t.Status }).ToList()
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
    public string Status { get; set; } = "not-started";
}
