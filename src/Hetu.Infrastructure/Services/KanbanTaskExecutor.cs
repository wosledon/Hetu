using System.Text;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
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
    private readonly ILogger<KanbanTaskExecutor> _logger;

    public KanbanTaskExecutor(
        IUnitOfWork unitOfWork,
        IBackgroundTaskQueue taskQueue,
        AgentLoopService agentLoop,
        WorkflowExecutionEngine workflowEngine,
        IWorkCommandRunnerFactory runnerFactory,
        InboxService inbox,
        ILogger<KanbanTaskExecutor> logger)
    {
        _unitOfWork = unitOfWork;
        _taskQueue = taskQueue;
        _agentLoop = agentLoop;
        _workflowEngine = workflowEngine;
        _runnerFactory = runnerFactory;
        _inbox = inbox;
        _logger = logger;
    }

    /// <summary>入队执行；无智能体/工作流或已排队中的任务不会重复入队</summary>
    public async Task<bool> TriggerAsync(Guid taskId, string trigger, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(taskId, cancellationToken);
        if (task == null || task.IsDeleted) return false;
        if (task.AgentId == null && task.WorkflowId == null) return false;

        await _taskQueue.QueueAsync(
            new BackgroundWorkItem(BackgroundTaskType.KanbanTaskExecute, taskId, trigger),
            cancellationToken);
        return true;
    }

    public async Task<bool> ExecuteAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        var task = await _unitOfWork.KanbanTasks.GetByIdAsync(taskId, cancellationToken);
        if (task == null || task.IsDeleted) return false;
        if (task.AgentId == null && task.WorkflowId == null) return false;

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
            await AddCommentAsync(task, "System", "系统", "任务已进入待办，自动开始处理。", null, cancellationToken);
        }

        var (projectName, rootPath, projectId, runner, diagnosticsCommand) = await ResolveWorkScopeAsync(task, cancellationToken);
        var agentName = task.AgentId != null
            ? (await _unitOfWork.PromptPresets.GetByIdAsync(task.AgentId.Value, cancellationToken))?.Name
            : null;
        var workflowName = task.WorkflowId != null
            ? (await _unitOfWork.Workflows.GetByIdAsync(task.WorkflowId.Value, cancellationToken))?.Name
            : null;

        var kind = task.WorkflowId != null ? "Workflow" : "Agent";
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

        var brief = await BuildBriefAsync(task, agentName, workflowName, projectName, rootPath, cancellationToken);
        run.Input = brief;
        await _unitOfWork.KanbanTaskRuns.UpdateAsync(run, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        try
        {
            string output;
            Guid? workflowRunId = null;

            if (task.WorkflowId != null)
            {
                var result = await _workflowEngine.ExecuteAsync(
                    task.WorkflowId.Value, brief, cancellationToken,
                    sink: null, chatTopicId: null, globalApprovalMode: "Auto");
                workflowRunId = result.RunId;
                if (result.Status == "Failed")
                    throw new InvalidOperationException(result.Error ?? "工作流执行失败");
                output = result.Output ?? "";
            }
            else
            {
                var preset = await _unitOfWork.PromptPresets.GetByIdAsync(task.AgentId!.Value, cancellationToken)
                    ?? throw new InvalidOperationException("智能体不存在");
                var tools = ParseTools(preset.ToolsConfig);

                var request = new AgentLoopRequest
                {
                    ModelId = null,
                    SystemPrompt = preset.Content,
                    Messages = new List<LlmChatMessage> { new() { Role = "user", Content = brief } },
                    ToolNames = tools,
                    ToolApprovals = tools.ToDictionary(t => t, _ => ToolApprovalMode.Auto),
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
                };

                var agentResult = await _agentLoop.RunAsync(request, cancellationToken);
                output = agentResult.Content;
                if (string.IsNullOrWhiteSpace(output) && !string.IsNullOrWhiteSpace(agentResult.Thinking))
                    output = agentResult.Thinking!;
            }

            if (string.IsNullOrWhiteSpace(output))
                throw new InvalidOperationException("执行未产生任何输出");

            run.Status = "Succeeded";
            run.Output = output;
            run.WorkflowRunId = workflowRunId;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.UpdatedAt = run.CompletedAt.Value;
            await _unitOfWork.KanbanTaskRuns.UpdateAsync(run, cancellationToken);

            var executorLabel = workflowName ?? agentName ?? "执行器";
            await AddCommentAsync(task, kind == "Workflow" ? "Workflow" : "Agent", executorLabel, output, run.Id, cancellationToken);
            await MoveStatusAsync(task, KanbanTaskStatuses.InReview, null, cancellationToken);

            await NotifyAsync(task, "Success",
                $"任务「{task.Title}」已完成处理，等待审核",
                Truncate(output, 500), cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[KanbanTask] 任务 {TaskId} 执行失败", taskId);

            run.Status = "Failed";
            run.Error = ex.Message;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.UpdatedAt = run.CompletedAt.Value;
            await _unitOfWork.KanbanTaskRuns.UpdateAsync(run, cancellationToken);

            await AddCommentAsync(task, "System", "系统", $"执行失败：{ex.Message}", run.Id, cancellationToken);
            await MoveStatusAsync(task, KanbanTaskStatuses.Blocked, Truncate(ex.Message, 200), cancellationToken);

            await NotifyAsync(task, "Error",
                $"任务「{task.Title}」执行失败",
                Truncate(ex.Message, 500), cancellationToken);
        }

        return true;
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
        KanbanTask task, string? agentName, string? workflowName, string? projectName, string? rootPath, CancellationToken ct)
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
        if (!string.IsNullOrWhiteSpace(rootPath)) sb.AppendLine($"- 项目目录：{rootPath}");
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
        sb.AppendLine("- 在项目目录内完成工作，必要时读取/修改文件、运行命令");
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
