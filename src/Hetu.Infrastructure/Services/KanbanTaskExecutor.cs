using System.Text;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Work;
using Hetu.Core.Services.Workflows;
using Hetu.Shared.Common;
using Hetu.Shared.Notifications;
using Hetu.Shared.Tasks;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Services;

/// <summary>
/// 看板任务自动执行：任务指定了智能体或工作流时，
/// 进入待办即由后台执行器代为处理，完成后进入审核中并通知用户；
/// 用户在审核中/已阻塞状态下提交评论，则根据评论重新处理。
/// </summary>
public interface IKanbanTaskExecutor
{
    /// <summary>入队一次执行（触发来源：进入待办 / 用户评论 / 手动重跑）</summary>
    Task<bool> TriggerAsync(Guid taskId, string trigger, CancellationToken cancellationToken = default);

    /// <summary>执行任务（由后台任务处理器调用）</summary>
    Task<bool> ExecuteAsync(Guid taskId, CancellationToken cancellationToken = default);
}

public class KanbanTaskExecutor : IKanbanTaskExecutor
{
    /// <summary>单次执行允许的最大智能体迭代数</summary>
    private const int MaxAgentIterations = 20;

    private readonly IUnitOfWork _unitOfWork;
    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly AgentLoopService _agentLoop;
    private readonly WorkflowExecutionEngine _workflowEngine;
    private readonly IWorkCommandRunnerFactory _runnerFactory;
    private readonly InboxService _inbox;
    private readonly ILlmUsageRecorder _usageRecorder;
    private readonly ILogger<KanbanTaskExecutor> _logger;
    private readonly ILocalizer _localizer;

    public KanbanTaskExecutor(
        IUnitOfWork unitOfWork,
        IBackgroundTaskQueue taskQueue,
        AgentLoopService agentLoop,
        WorkflowExecutionEngine workflowEngine,
        IWorkCommandRunnerFactory runnerFactory,
        InboxService inbox,
        ILlmUsageRecorder usageRecorder,
        ILogger<KanbanTaskExecutor> logger,
        ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _taskQueue = taskQueue;
        _agentLoop = agentLoop;
        _workflowEngine = workflowEngine;
        _runnerFactory = runnerFactory;
        _inbox = inbox;
        _usageRecorder = usageRecorder;
        _logger = logger;
        _localizer = localizer;
    }

    /// <summary>入队执行；无智能体/工作流或已排队中的任务不会重复入队</summary>
    public async Task<bool> TriggerAsync(Guid taskId, string trigger, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(taskId, cancellationToken);
        if (task == null || task.IsDeleted) return false;
        if (!HasAutomation(task)) return false;

        await _taskQueue.QueueAsync(
            new BackgroundWorkItem(BackgroundTaskType.KanbanTaskExecute, taskId, trigger),
            cancellationToken);
        return true;
    }

    /// <summary>是否配置了自动处理：数据库智能体 / 项目 .github 智能体 / 工作流</summary>
    private static bool HasAutomation(KanbanTask task)
        => task.AgentId != null || task.WorkflowId != null || !string.IsNullOrWhiteSpace(task.AgentPrompt);

    public async Task<bool> ExecuteAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(taskId, cancellationToken);
        if (task == null || task.IsDeleted) return false;
        if (!HasAutomation(task)) return false;

        // 已有执行中的运行则跳过，避免重复触发
        var runs = await _unitOfWork.KanbanTaskRuns.FindAsync(r => r.TaskId == taskId, cancellationToken);
        if (runs.Any(r => r.Status == "Running"))
        {
            _logger.LogInformation("[KanbanTask] 任务 {TaskId} 已有执行中的运行，跳过本次触发", taskId);
            return false;
        }

        // 触发来源需在流转状态前记录：待办触发还是评论触发
        var trigger = task.Status == KanbanTaskStatuses.Todo ? "Todo" : "Comment";

        // 进入待办 → 先流转到进行中；评论触发时已由调用方置为进行中
        if (task.Status == KanbanTaskStatuses.Todo)
        {
            await MoveStatusAsync(task, KanbanTaskStatuses.InProgress, null, cancellationToken);
            await AddCommentAsync(task, "System", _localizer.T("kanban.systemAuthor"), _localizer.T("kanban.autoStartedComment"), null, cancellationToken);
        }

        var (projectName, rootPath, projectId, runner, diagnosticsCommand) = await ResolveWorkScopeAsync(task, cancellationToken);
        // 项目 .github 智能体没有数据库记录，直接用任务上存的正文与名字
        var agentName = task.AgentId != null
            ? (await _unitOfWork.PromptPresets.GetByIdAsync(task.AgentId.Value, cancellationToken))?.Name
            : task.AgentPromptName;
        var workflowName = task.WorkflowId != null
            ? (await _unitOfWork.Workflows.GetByIdAsync(task.WorkflowId.Value, cancellationToken))?.Name
            : null;

        var kind = task.WorkflowId != null ? "Workflow" : "Agent";
        var executorLabel = workflowName ?? agentName ?? _localizer.T("kanban.executorLabel");
        var run = new KanbanTaskRun
        {
            Id = Guid.NewGuid(),
            TaskId = taskId,
            Kind = kind,
            Trigger = trigger,
            Status = "Running",
            StartedAt = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await _unitOfWork.KanbanTaskRuns.AddAsync(run, cancellationToken);
        task.LastRunId = run.Id;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.KanbanTasks.UpdateAsync(task, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var brief = await BuildBriefAsync(task, agentName, workflowName, projectName, rootPath, runner?.IsRemote == true, cancellationToken);
        run.Input = brief;
        await _unitOfWork.KanbanTaskRuns.UpdateAsync(run, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var stepWriter = new RunStepWriter(_unitOfWork, run);

        // 后台执行无人值守：提问即阻塞——中断本次执行，把问题交给用户回答
        Task<string> OnQuestionAsync(LlmToolCall toolCall)
            => throw new KanbanTaskQuestionPendingException(ExtractQuestionText(toolCall.Arguments));

        try
        {
            string output;
            Guid? workflowRunId = null;

            if (task.WorkflowId != null)
            {
                var result = await _workflowEngine.ExecuteAsync(
                    task.WorkflowId.Value, brief, cancellationToken,
                    sink: new WorkflowRunSink(stepWriter, cancellationToken),
                    chatTopicId: null,
                    globalApprovalMode: "Auto",
                    questionHandler: OnQuestionAsync);
                workflowRunId = result.RunId;
                if (result.Status == "Failed")
                {
                    // 工作流引擎把异常转为 Failed 结果，提问前缀原样带回
                    if (KanbanTaskQuestionPendingException.TryParse(result.Error, out var pendingInWorkflow))
                        throw new KanbanTaskQuestionPendingException(pendingInWorkflow);
                    throw new InvalidOperationException(result.Error ?? _localizer.T("kanban.workflowFailed"));
                }
                output = result.Output ?? "";
            }
            else
            {
                // 数据库智能体用预设正文与工具清单；项目 .github 智能体用任务上存的正文 + 默认工具集
                string systemPrompt;
                List<string> tools;
                if (task.AgentId != null)
                {
                    var preset = await _unitOfWork.PromptPresets.GetByIdAsync(task.AgentId.Value, cancellationToken)
                        ?? throw new InvalidOperationException(_localizer.T("kanban.agentNotFound"));
                    systemPrompt = preset.Content;
                    tools = ParseTools(preset.ToolsConfig);
                }
                else
                {
                    systemPrompt = task.AgentPrompt!;
                    tools = BuiltinProfiles.Work.AllowedTools.ToList();
                }
                // 项目任务改用 work_* 工具集：本地与 SSH 远端统一走项目 runner；
                // 通用 run_command 只在本机执行，项目场景下由 work_run_command 取代
                if (!string.IsNullOrEmpty(rootPath))
                    tools = tools
                        .Where(t => !string.Equals(t, "run_command", StringComparison.OrdinalIgnoreCase))
                        .Concat(BuiltinProfiles.Work.AllowedTools)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                var toolApprovals = tools.ToDictionary(t => t, _ => ToolApprovalMode.Auto);
                // 通配兜底：未在智能体工具清单内的调用同样自动执行，不停下等待审批
                toolApprovals["*"] = ToolApprovalMode.Auto;

                var request = new AgentLoopRequest
                {
                    ModelId = null,
                    SystemPrompt = systemPrompt,
                    Messages = new List<LlmChatMessage> { new() { Role = "user", Content = brief } },
                    ToolNames = tools,
                    ToolApprovals = toolApprovals,
                    QuestionHandler = OnQuestionAsync,
                    MaxIterations = MaxAgentIterations,
                    SessionId = $"kanban-task-{taskId}-{run.Id}",
                    WorkScope = string.IsNullOrEmpty(rootPath)
                        ? null
                        : new WorkToolScope
                        {
                            ProjectRoot = rootPath,
                            ProjectId = projectId,
                            DiagnosticsCommand = diagnosticsCommand,
                            Runner = runner,
                        },
                    Sink = new AgentRunSink(stepWriter, cancellationToken),
                };

                var agentResult = await _agentLoop.RunAsync(request, cancellationToken);
                output = agentResult.Content;
                if (string.IsNullOrWhiteSpace(output) && !string.IsNullOrWhiteSpace(agentResult.Thinking))
                    output = agentResult.Thinking!;

                // 看板任务同样是 LLM 调用方，统一记入用量统计
                await _usageRecorder.RecordAsync(
                    LlmUsageSources.Kanban,
                    agentResult.Usage.TotalTokens > 0 ? agentResult.Usage : null,
                    refId: taskId,
                    contentPreview: output,
                    ct: cancellationToken);
            }

            if (string.IsNullOrWhiteSpace(output))
                throw new InvalidOperationException(_localizer.T("kanban.noOutput"));

            run.Status = "Succeeded";
            run.Output = output;
            run.WorkflowRunId = workflowRunId;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.UpdatedAt = run.CompletedAt.Value;
            await _unitOfWork.KanbanTaskRuns.UpdateAsync(run, cancellationToken);

            await AddCommentAsync(task, kind == "Workflow" ? "Workflow" : "Agent", executorLabel, output, run.Id, cancellationToken);
            await MoveStatusAsync(task, KanbanTaskStatuses.InReview, null, cancellationToken);

            await NotifyAsync(task, InboxLevels.Success,
                _localizer.T("kanban.completedPendingReview", task.Title),
                Truncate(output, 500), cancellationToken);
        }
        catch (KanbanTaskQuestionPendingException pending)
        {
            _logger.LogInformation("[KanbanTask] 任务 {TaskId} 智能体提问，等待用户回答：{Question}", taskId, pending.Question);

            run.Status = "WaitingAnswer";
            run.Output = pending.Question;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.UpdatedAt = run.CompletedAt.Value;
            await _unitOfWork.KanbanTaskRuns.UpdateAsync(run, cancellationToken);

            await AddCommentAsync(task, kind == "Workflow" ? "Workflow" : "Agent", executorLabel, pending.Question, run.Id, cancellationToken);
            await MoveStatusAsync(task, KanbanTaskStatuses.Blocked,
                Truncate(_localizer.T("kanban.waitingAnswer", FirstLine(pending.Question)), 200), cancellationToken);

            await NotifyAsync(task, InboxLevels.Warning,
                _localizer.T("kanban.needAnswer", task.Title),
                Truncate(pending.Question, 500), cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[KanbanTask] 任务 {TaskId} 执行失败", taskId);

            run.Status = "Failed";
            run.Error = ex.Message;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.UpdatedAt = run.CompletedAt.Value;
            await _unitOfWork.KanbanTaskRuns.UpdateAsync(run, cancellationToken);

            await AddCommentAsync(task, "System", _localizer.T("kanban.systemAuthor"), _localizer.T("kanban.commentFailed", ex.Message), run.Id, cancellationToken);
            await MoveStatusAsync(task, KanbanTaskStatuses.Blocked, Truncate(ex.Message, 200), cancellationToken);

            await NotifyAsync(task, InboxLevels.Error,
                _localizer.T("kanban.taskFailed", task.Title),
                Truncate(ex.Message, 500), cancellationToken);
        }

        return true;
    }

    /// <summary>
    /// 智能体提问：中断执行并阻塞任务，等用户在评论中回答后再继续。
    /// 消息带前缀，便于穿过工作流引擎「异常转 Failed 结果」的路径被识别。
    /// </summary>
    public sealed class KanbanTaskQuestionPendingException : Exception
    {
        public const string MessagePrefix = "KANBAN_QUESTION_PENDING:";

        public string Question { get; }

        public KanbanTaskQuestionPendingException(string question) : base(MessagePrefix + question)
            => Question = question;

        public static bool TryParse(string? message, out string question)
        {
            question = string.Empty;
            if (string.IsNullOrEmpty(message)
                || !message.StartsWith(MessagePrefix, StringComparison.Ordinal))
                return false;
            question = message[MessagePrefix.Length..];
            return true;
        }
    }

    /// <summary>执行过程步骤写入器：Agent/工作流事件按顺序落库为时间线步骤</summary>
    private sealed class RunStepWriter
    {
        private readonly IUnitOfWork _unitOfWork;
        private readonly KanbanTaskRun _run;
        private int _sequence;

        public RunStepWriter(IUnitOfWork unitOfWork, KanbanTaskRun run)
        {
            _unitOfWork = unitOfWork;
            _run = run;
        }

        public async Task WriteAsync(string kind, string? title, string content, bool isError, CancellationToken ct)
        {
            if (string.IsNullOrEmpty(content)) return;
            var now = DateTimeOffset.UtcNow;
            var step = new KanbanTaskRunStep
            {
                Id = Guid.NewGuid(),
                TaskId = _run.TaskId,
                RunId = _run.Id,
                Kind = kind,
                Title = title,
                Content = Truncate(content, 4000),
                IsError = isError,
                Sequence = ++_sequence,
                CreatedAt = now,
                UpdatedAt = now,
            };
            await _unitOfWork.KanbanTaskRunSteps.AddAsync(step, ct);
            await _unitOfWork.SaveChangesAsync(ct);
        }
    }

    /// <summary>智能体执行过程 → 步骤流水（思考 / 输出 / 工具调用 / 工具结果）</summary>
    private sealed class AgentRunSink : IAgentLoopSink
    {
        private readonly RunStepWriter _writer;
        private readonly StringBuilder _text = new();
        private readonly StringBuilder _thinking = new();
        private string? _pendingToolName;
        private readonly CancellationToken _ct;

        public AgentRunSink(RunStepWriter writer, CancellationToken ct)
        {
            _writer = writer;
            _ct = ct;
        }

        /// <summary>思考是流式增量，先缓冲，在一次迭代结束（出文本或工具调用）时合并为一条</summary>
        public Task OnThinkingAsync(string text)
        {
            _thinking.Append(text);
            return Task.CompletedTask;
        }

        public async Task OnContentAsync(string text)
        {
            await FlushThinkingAsync();
            _text.Append(text);
        }

        public async Task OnToolCallAsync(LlmToolCall toolCall)
        {
            await FlushThinkingAsync();
            await FlushTextAsync();
            _pendingToolName = toolCall.Name;
            await _writer.WriteAsync("ToolCall", toolCall.Name, toolCall.Arguments, false, _ct);
        }

        public Task OnToolResultAsync(string toolCallId, string content, bool isError)
            => _writer.WriteAsync("ToolResult", _pendingToolName, content, isError, _ct);

        public Task OnDebugAsync(string text) => Task.CompletedTask;

        private async Task FlushThinkingAsync()
        {
            if (_thinking.Length == 0) return;
            var content = _thinking.ToString();
            _thinking.Clear();
            await _writer.WriteAsync("Thought", null, content, false, _ct);
        }

        private async Task FlushTextAsync()
        {
            if (_text.Length == 0) return;
            var content = _text.ToString();
            _text.Clear();
            await _writer.WriteAsync("Text", null, content, false, _ct);
        }
    }

    /// <summary>工作流执行过程 → 步骤流水（节点输出 + Agent 节点内工具调用）</summary>
    private sealed class WorkflowRunSink : IWorkflowEventSink
    {
        private readonly RunStepWriter _writer;
        private readonly Dictionary<string, string> _nodeLabels = new(StringComparer.OrdinalIgnoreCase);
        private readonly CancellationToken _ct;

        public WorkflowRunSink(RunStepWriter writer, CancellationToken ct)
        {
            _writer = writer;
            _ct = ct;
        }

        public Task OnNodeStartedAsync(Guid runId, string nodeId, string nodeType, string label)
        {
            _nodeLabels[nodeId] = label;
            return Task.CompletedTask;
        }

        public Task OnNodeCompletedAsync(Guid runId, string nodeId, string output)
        {
            var label = _nodeLabels.TryGetValue(nodeId, out var l) ? l : nodeId;
            return _writer.WriteAsync("Node", label, output, false, _ct);
        }

        public Task OnNodeFailedAsync(Guid runId, string nodeId, string error)
        {
            var label = _nodeLabels.TryGetValue(nodeId, out var l) ? l : nodeId;
            return _writer.WriteAsync("Node", label, error, true, _ct);
        }

        public Task OnAgentToolCallAsync(Guid runId, string nodeId, string toolCallId, string name, string arguments)
        {
            var label = _nodeLabels.TryGetValue(nodeId, out var l) ? l : nodeId;
            return _writer.WriteAsync("ToolCall", $"{label} · {name}", arguments, false, _ct);
        }
    }

    /// <summary>从 ask_question 参数中提取可读的问题文本（Markdown）</summary>
    private string ExtractQuestionText(string? argumentsJson)
    {
        if (!string.IsNullOrWhiteSpace(argumentsJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(argumentsJson);
                if (doc.RootElement.TryGetProperty("questions", out var questions)
                    && questions.ValueKind == JsonValueKind.Array)
                {
                    var sb = new StringBuilder();
                    foreach (var q in questions.EnumerateArray())
                    {
                        var header = q.TryGetProperty("header", out var h) ? h.GetString() : null;
                        var body = q.TryGetProperty("question", out var t) ? t.GetString() : null;
                        if (!string.IsNullOrWhiteSpace(header)) sb.AppendLine($"### {header}");
                        if (!string.IsNullOrWhiteSpace(body)) sb.AppendLine(body);
                        if (q.TryGetProperty("options", out var options) && options.ValueKind == JsonValueKind.Array)
                            foreach (var o in options.EnumerateArray())
                            {
                                var label = o.TryGetProperty("label", out var l) ? l.GetString() : null;
                                if (!string.IsNullOrWhiteSpace(label)) sb.AppendLine($"- {label}");
                            }
                        sb.AppendLine();
                    }
                    var text = sb.ToString().Trim();
                    if (text.Length > 0) return text;
                }
            }
            catch (JsonException)
            {
            }
        }
        return string.IsNullOrWhiteSpace(argumentsJson) ? _localizer.T("kanban.agentAskedQuestion") : argumentsJson!;
    }

    private string FirstLine(string text)
    {
        var line = text.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
        return string.IsNullOrEmpty(line) ? _localizer.T("kanban.agentAskedQuestion") : line;
    }

    /// <summary>解析执行作用域：优先关联的 Code 工作项目，其次项目管理登记的目录</summary>
    private async Task<(string? ProjectName, string? RootPath, Guid? ProjectId, IWorkCommandRunner? Runner, string? DiagnosticsCommand)>
        ResolveWorkScopeAsync(KanbanTask task, CancellationToken ct)
    {
        Hetu.Core.Entities.WorkProject? workProject = null;
        if (task.ProjectId != null)
        {
            workProject = (await _unitOfWork.WorkProjects.FindAsync(
                w => w.ManagedProjectId == task.ProjectId, ct)).FirstOrDefault();
        }

        if (workProject != null)
        {
            var runner = workProject.ConnectionType == "Ssh" ? _runnerFactory.Create(workProject) : null;
            return (workProject.Name, workProject.RootPath, workProject.Id, runner, workProject.DiagnosticsCommand);
        }

        var managed = task.ProjectId != null
            ? await _unitOfWork.ManagedProjects.GetByIdAsync(task.ProjectId.Value, ct)
            : null;
        var managedRunner = managed != null && managed.ProjectType == "Ssh"
            ? _runnerFactory.Create(new Hetu.Core.Entities.WorkProject
            {
                Id = Guid.NewGuid(),
                Name = managed.Name,
                RootPath = managed.DirectoryPath,
                ConnectionType = "Ssh",
                SshHost = managed.SshHost,
                SshPort = managed.SshPort,
                SshUser = managed.SshUser,
                SshAuthType = managed.SshAuthType,
                SshKeyPath = managed.SshKeyPath,
                SshPasswordProtected = managed.SshPasswordProtected,
            })
            : null;
        return (managed?.Name, managed?.DirectoryPath, null, managedRunner, null);
    }

    /// <summary>组装任务简报：任务信息 + 项目路径 + 历史沟通记录</summary>
    private async Task<string> BuildBriefAsync(
        KanbanTask task, string? agentName, string? workflowName, string? projectName, string? rootPath, bool isRemote, CancellationToken ct)
    {
        var comments = await _unitOfWork.KanbanTaskComments.FindAsync(c => c.TaskId == task.Id, ct);
        var sb = new StringBuilder();
        sb.AppendLine($"# 任务：{task.Title}");
        if (!string.IsNullOrWhiteSpace(task.Description))
            sb.AppendLine().Append(task.Description);

        sb.AppendLine().AppendLine("## 任务上下文");
        sb.AppendLine($"- 优先级：{task.Priority}");
        if (task.DueDate != null) sb.AppendLine($"- 截止日期：{task.DueDate:yyyy-MM-dd}");
        if (!string.IsNullOrWhiteSpace(projectName)) sb.AppendLine($"- 项目：{projectName}");
        if (!string.IsNullOrWhiteSpace(rootPath))
            sb.AppendLine(isRemote ? $"- 项目目录（SSH 远端）：{rootPath}" : $"- 项目目录：{rootPath}");
        if (!string.IsNullOrWhiteSpace(agentName)) sb.AppendLine($"- 执行智能体：{agentName}");
        if (!string.IsNullOrWhiteSpace(workflowName)) sb.AppendLine($"- 执行工作流：{workflowName}");

        var history = comments
            .Where(c => !c.IsDeleted)
            .OrderBy(c => c.CreatedAt)
            .ToList();
        if (history.Count > 0)
        {
            sb.AppendLine().AppendLine("## 沟通记录（按时间顺序）");
            foreach (var c in history)
                sb.AppendLine($"[{c.AuthorType}:{c.AuthorName}] {c.Content}");
        }

        sb.AppendLine().AppendLine("## 完成要求");
        sb.AppendLine("- 在项目目录内完成工作：读取/修改文件、执行命令请使用 work_* 系列工具（路径相对项目根目录）");
        sb.AppendLine("- 缺少关键信息时使用 ask_question 提问，任务会阻塞并等待用户回答，不要臆测");
        sb.AppendLine("- 完成后用要点总结：做了什么、改了哪些文件、如何验证、遗留问题");
        sb.AppendLine("- 不要修改与本任务无关的内容");
        return sb.ToString();
    }

    private async Task MoveStatusAsync(KanbanTask task, string status, string? blockedReason, CancellationToken ct)
    {
        if (task.Status == status) return;

        var now = DateTimeOffset.UtcNow;
        task.Status = status;
        task.BlockedReason = status == KanbanTaskStatuses.Blocked ? blockedReason : null;
        if (status == KanbanTaskStatuses.Done && task.CompletedAt == null) task.CompletedAt = now;
        else if (status != KanbanTaskStatuses.Done) task.CompletedAt = null;
        if (status == KanbanTaskStatuses.Archived) task.ArchivedAt ??= now;
        else if (status != KanbanTaskStatuses.Archived) task.ArchivedAt = null;
        task.UpdatedAt = now;
        await _unitOfWork.KanbanTasks.UpdateAsync(task, ct);
        await _unitOfWork.SaveChangesAsync(ct);
    }

    private async Task AddCommentAsync(
        KanbanTask task, string authorType, string authorName, string content, Guid? runId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        await _unitOfWork.KanbanTaskComments.AddAsync(new KanbanTaskComment
        {
            Id = Guid.NewGuid(),
            TaskId = task.Id,
            AuthorType = authorType,
            AuthorName = authorName,
            Content = content,
            RunId = runId,
            CreatedAt = now,
            UpdatedAt = now,
        }, ct);
        await _unitOfWork.SaveChangesAsync(ct);
    }

    /// <summary>写入收件箱通知（同一任务按合并键聚合到一条）</summary>
    private Task NotifyAsync(KanbanTask task, string level, string title, string content, CancellationToken ct)
        => _inbox.CreateAsync(new CreateInboxNotificationRequest
        {
            Category = InboxCategories.KanbanTask,
            CategoryKey = $"kanban-task:{task.Id}",
            Level = level,
            Title = title,
            Content = content,
            Link = $"/kanban/{task.Id}",
        }, ct);

    private static List<string> ParseTools(string? toolsConfigJson)
    {
        if (string.IsNullOrWhiteSpace(toolsConfigJson)) return [];
        try
        {
            using var doc = JsonDocument.Parse(toolsConfigJson);
            if (!doc.RootElement.TryGetProperty("tools", out var toolsEl) || toolsEl.ValueKind != JsonValueKind.Array)
                return [];
            return toolsEl.EnumerateArray()
                .Select(t => t.ValueKind == JsonValueKind.String ? t.GetString() : null)
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t!)
                .ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : string.Concat(text.AsSpan(0, max), "…");
}
