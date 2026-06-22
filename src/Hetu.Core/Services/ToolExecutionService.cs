using System.Collections.Concurrent;
using System.Text;
using Hetu.Core.Interfaces;
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

/// <summary>Per-session state for pending interactive tool calls.</summary>
public class SessionPendingState
{
    public ConcurrentDictionary<string, TaskCompletionSource<string>> Questions = new();
    public ConcurrentDictionary<string, TaskCompletionSource<bool>> Approvals = new();
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

    private readonly Session<SessionPendingState> _sessions = new();

    public ToolExecutionService(ILogger<ToolExecutionService> logger, IServiceScopeFactory scopeFactory)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
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

    /// <summary>
    /// Execute a list of tool calls within a session, handling approval, ask_question, and todo.
    /// Returns the tool results so the caller can add them to the LLM chat history.
    /// </summary>
    public async Task<List<(string toolCallId, string content)>> ExecuteToolCallsAsync(
        string sessionId,
        List<LlmToolCall> toolCalls,
        Dictionary<string, ToolApprovalMode> approvalOverrides,
        List<SessionTodo> sessionTodos,
        Func<string, Task> writeEventAsync,
        Func<object, Task> writeJsonAsync,
        CancellationToken cancellationToken)
    {
        var results = new List<(string toolCallId, string content)>();
        var state = _sessions.GetOrCreate(sessionId);

        await using var scope = _scopeFactory.CreateAsyncScope();
        var toolRegistry = scope.ServiceProvider.GetRequiredService<ToolRegistry>();

        foreach (var toolCall in toolCalls)
        {
            bool isSilentTool = toolCall.Name is "todo" or "ask_question";

            await writeJsonAsync(new
            {
                type = "tool_call",
                id = toolCall.Id,
                name = toolCall.Name,
                arguments = toolCall.Arguments,
                hidden = isSilentTool
            });

            var executor = toolRegistry.GetExecutor(toolCall.Name);
            var approval = approvalOverrides.GetValueOrDefault(toolCall.Name,
                approvalOverrides.GetValueOrDefault("*",
                    executor?.DefaultApproval ?? ToolApprovalMode.Auto));

            string resultContent;
            bool isError = false;

            if (approval == ToolApprovalMode.Ask && toolCall.Name != "ask_question" && toolCall.Name != "todo")
            {
                (resultContent, isError) = await ExecuteWithApprovalAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, cancellationToken);
            }
            else if (executor != null)
            {
                (resultContent, isError) = await ExecuteSingleToolAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, cancellationToken);
            }
            else
            {
                resultContent = $"未找到工具: {toolCall.Name}";
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

            results.Add((toolCall.Id, resultContent));
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
            return ($"用户未在规定时间内确认工具 \"{toolCall.Name}\" 的执行，已跳过。", true);
        }
        finally
        {
            state.Approvals.TryRemove(toolCall.Id, out _);
        }

        if (!approved)
            return ($"用户拒绝了工具 \"{toolCall.Name}\" 的执行。", true);

        if (executor != null)
            return await ExecuteSingleToolAsync(state, toolCall, executor, sessionTodos, writeJsonAsync, ct);

        return ($"未找到工具: {toolCall.Name}", true);
    }

    private async Task<(string content, bool isError)> ExecuteSingleToolAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        IToolExecutor executor,
        List<SessionTodo> sessionTodos,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct)
    {
        try
        {
            if (toolCall.Name == "ask_question")
                return await HandleAskQuestionAsync(state, toolCall, writeJsonAsync, ct);

            if (toolCall.Name == "todo")
                return await HandleTodoAsync(toolCall, sessionTodos, writeJsonAsync, ct);

            var result = await executor.ExecuteAsync(toolCall.Arguments, ct);
            return (result.Content, result.IsError);
        }
        catch (Exception ex)
        {
            return ($"工具执行失败: {ex.Message}", true);
        }
    }

    private async Task<(string content, bool isError)> HandleAskQuestionAsync(
        SessionPendingState state,
        LlmToolCall toolCall,
        Func<object, Task> writeJsonAsync,
        CancellationToken ct)
    {
        await writeJsonAsync(new { type = "question", toolCallId = toolCall.Id, data = toolCall.Arguments });

        var tcs = new TaskCompletionSource<string>();
        state.Questions[toolCall.Id] = tcs;

        try
        {
            var answer = await tcs.Task.WaitAsync(TimeSpan.FromMinutes(5), ct);
            return (answer, false);
        }
        catch (TimeoutException)
        {
            return ("用户未在规定时间内回答，跳过此问题。", false);
        }
        finally
        {
            state.Questions.TryRemove(toolCall.Id, out _);
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
            return ("当前工作计划为空。使用 action=create 创建步骤。", false);

        var sb = new StringBuilder();
        sb.AppendLine($"当前工作计划（共 {sessionTodos.Count} 个步骤）：");
        foreach (var t in sessionTodos)
        {
            var mark = t.Status switch
            {
                "completed" => "[已完成]",
                "in-progress" => "[进行中]",
                _ => "[未开始]"
            };
            sb.AppendLine($"  - id={t.Id} {mark} {t.Title}");
        }

        var next = sessionTodos.FirstOrDefault(t => t.Status != "completed");
        if (next != null)
        {
            sb.AppendLine();
            sb.AppendLine($"下一步：开始执行 \"{next.Title}\"（id={next.Id}）。先调用 todo(action=update, id={next.Id}, status=in-progress)，做完后调用 todo(action=complete, id={next.Id})。");
        }
        else
        {
            sb.AppendLine();
            sb.AppendLine("所有步骤已完成。");
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