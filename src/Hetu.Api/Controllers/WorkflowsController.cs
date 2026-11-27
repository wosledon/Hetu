using System.Text.Json;
using Hetu.Api.Streaming;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Work;
using Hetu.Core.Services.Workflows;
using Hetu.Core.Utilities;
using Hetu.Shared.Common;
using Hetu.Shared.Workflow;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/workflows")]
public class WorkflowsController : ControllerBase
{
    private readonly IWorkflowService _workflowService;
    private readonly MafWorkflowRunner _engine;
    private readonly WorkflowApprovalService _approvalService;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IChatMessageService _chatMessageService;
    private readonly IWorkSessionService _workSessionService;
    private readonly IWorkCommandRunnerFactory _commandRunnerFactory;
    private readonly ToolRegistry _toolRegistry;
    private readonly ILocalizer _localizer;

    public WorkflowsController(
        IWorkflowService workflowService,
        MafWorkflowRunner engine,
        WorkflowApprovalService approvalService,
        IUnitOfWork unitOfWork,
        IChatMessageService chatMessageService,
        IWorkSessionService workSessionService,
        IWorkCommandRunnerFactory commandRunnerFactory,
        ToolRegistry toolRegistry,
        ILocalizer localizer)
    {
        _workflowService = workflowService;
        _engine = engine;
        _approvalService = approvalService;
        _unitOfWork = unitOfWork;
        _chatMessageService = chatMessageService;
        _workSessionService = workSessionService;
        _commandRunnerFactory = commandRunnerFactory;
        _toolRegistry = toolRegistry;
        _localizer = localizer;
    }

    [HttpGet]
    public Task<ApiResponse<List<WorkflowDto>>> GetAll(CancellationToken cancellationToken)
        => _workflowService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WorkflowDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _workflowService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<WorkflowDto>> Create([FromBody] CreateWorkflowRequest request, CancellationToken cancellationToken)
        => _workflowService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<WorkflowDto>> Update(Guid id, [FromBody] UpdateWorkflowRequest request, CancellationToken cancellationToken)
        => _workflowService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _workflowService.DeleteAsync(id, cancellationToken);

    [HttpPost("{id:guid}/duplicate")]
    public Task<ApiResponse<WorkflowDto>> Duplicate(Guid id, CancellationToken cancellationToken)
        => _workflowService.DuplicateAsync(id, cancellationToken);

    [HttpGet("{id:guid}/validate")]
    public Task<ApiResponse<ValidationResultDto>> Validate(Guid id, CancellationToken cancellationToken)
        => _workflowService.ValidateAsync(id, cancellationToken);

    /// <summary>非流式执行工作流，返回最终结果</summary>
    [HttpPost("{id:guid}/run")]
    public async Task<ApiResponse<WorkflowRunResult>> Run(Guid id, [FromBody] RunWorkflowRequest? request, CancellationToken cancellationToken)
    {
        var (workScope, decideToolCall, error, _) = await PrepareWorkContextAsync(request, cancellationToken);
        if (error != null) return ApiResponse<WorkflowRunResult>.Fail(error);
        var result = await _engine.ExecuteAsync(id, request?.Input, cancellationToken, 0, null, null,
            workScope: workScope, decideToolCall: decideToolCall);
        return ApiResponse<WorkflowRunResult>.Ok(result);
    }

    /// <summary>流式执行工作流，通过 SSE 推送节点事件</summary>
    [HttpPost("{id:guid}/run/stream")]
    public async Task RunStream(Guid id, [FromBody] RunWorkflowRequest? request, CancellationToken cancellationToken)
    {
        Response.StartSseStream();

        var writer = new SseStreamWriter(Response, cancellationToken);
        var sink = new SseWorkflowEventSink(writer);

        try
        {
            var (workScope, decideToolCall, error, notice) = await PrepareWorkContextAsync(request, cancellationToken);
            if (error != null)
            {
                await writer.WriteErrorAsync(error);
                return;
            }
            if (!string.IsNullOrWhiteSpace(notice))
                await writer.WriteJsonAsync(new { type = "notice", text = notice });

            if (request?.WorkSessionId is Guid workSessionId && !string.IsNullOrWhiteSpace(request.Input))
            {
                await _workSessionService.AddMessageAsync(workSessionId, "user", request.Input,
                    metadata: JsonSerializer.Serialize(new { workflowId = id }), cancellationToken: cancellationToken);
            }

            var result = await _engine.ExecuteAsync(id, request?.Input, cancellationToken, 0, sink, null,
                workScope: workScope, decideToolCall: decideToolCall);
            if (request?.WorkSessionId is Guid sessionId)
            {
                var output = result.Status switch
                {
                    "Succeeded" when !string.IsNullOrWhiteSpace(result.Output) => result.Output,
                    "Succeeded" => null,
                    "Cancelled" => _localizer.T("workflow.runCancelled"),
                    _ => result.Error ?? _localizer.T("workflows.executionFailed", result.Error ?? string.Empty)
                };
                if (!string.IsNullOrWhiteSpace(output))
                {
                    await _workSessionService.AddMessageAsync(sessionId, "assistant", output,
                        metadata: JsonSerializer.Serialize(new { workflowId = id, runId = result.RunId }),
                        cancellationToken: CancellationToken.None);
                }
            }
            await writer.WriteJsonAsync(new { type = "run_result", result });
        }
        catch (Exception ex)
        {
            await writer.WriteErrorAsync(ex.Message);
        }
    }

    /// <summary>在对话内调用工作流：关联 ChatTopic，流式推送事件，并将最终输出保存为助手消息</summary>
    [HttpPost("{id:guid}/run/topic/{topicId:guid}/stream")]
    public async Task RunStreamInTopic(Guid id, Guid topicId, [FromBody] RunWorkflowRequest? request, CancellationToken cancellationToken)
    {
        Response.StartSseStream();

        var writer = new SseStreamWriter(Response, cancellationToken);
        var sink = new SseWorkflowEventSink(writer);

        try
        {
            // 保存用户消息
            if (!string.IsNullOrWhiteSpace(request?.Input))
            {
                await _chatMessageService.CreateUserMessageAsync(topicId, request.Input, cancellationToken);
            }

            var decideToolCall = CreatePermissionDecider(request?.PermissionMode);
            var result = await _engine.ExecuteAsync(id, request?.Input, cancellationToken, 0, sink, topicId,
                workScope: null, decideToolCall: decideToolCall);

            // 将工作流输出保存为对话的助手消息
            if (result.Status == "Succeeded" && !string.IsNullOrWhiteSpace(result.Output))
            {
                await _chatMessageService.SaveAssistantMessageAsync(
                    topicId,
                    result.Output,
                    modelId: null,
                    cancellationToken: cancellationToken);
            }
            else if (result.Status == "Failed")
            {
                await _chatMessageService.SaveAssistantMessageAsync(
                    topicId,
                    _localizer.T("workflows.executionFailed", result.Error ?? string.Empty),
                    modelId: null,
                    cancellationToken: cancellationToken);
            }

            await writer.WriteJsonAsync(new { type = "run_result", result });
        }
        catch (Exception ex)
        {
            await writer.WriteErrorAsync(ex.Message);
        }
    }

    /// <summary>查询运行状态与节点记录</summary>
    [HttpGet("runs/{runId:guid}")]
    public async Task<ApiResponse<object>> GetRun(Guid runId, CancellationToken cancellationToken)
    {
        var run = await _unitOfWork.WorkflowRuns.GetByIdAsync(runId, cancellationToken);
        if (run == null) return ApiResponse<object>.Fail(_localizer.T("workflows.runNotFound"));

        var nodes = await _unitOfWork.WorkflowRunNodes.FindAsync(n => n.RunId == runId, cancellationToken);
        return ApiResponse<object>.Ok(new
        {
            run = MapRun(run),
            nodes = nodes.OrderBy(n => n.StartedAt).Select(MapRunNode)
        });
    }

    /// <summary>查询工作流的运行历史</summary>
    [HttpGet("{id:guid}/runs")]
    public async Task<ApiResponse<List<object>>> GetRuns(Guid id, CancellationToken cancellationToken)
    {
        var runs = await _unitOfWork.WorkflowRuns.FindAsync(r => r.WorkflowId == id, cancellationToken);
        return ApiResponse<List<object>>.Ok(
            runs.OrderByDescending(r => r.CreatedAt).Select(MapRun).ToList());
    }

    /// <summary>审批 Human 节点</summary>
    [HttpPost("runs/{runId:guid}/approve")]
    public ApiResponse Approve(Guid runId, [FromBody] ApproveRequest request)
    {
        // 查找该 run 下的挂起审批
        var pending = _approvalService.GetPendingForRun(runId.ToString());
        var target = pending.FirstOrDefault(p => p.NodeId == request.NodeId) ?? pending.FirstOrDefault();
        if (target == null) return ApiResponse.Fail(_localizer.T("workflows.approvalNotFound"));

        _approvalService.TryResolve(runId.ToString(), target.NodeId, request.Approve);
        return ApiResponse.Ok();
    }

    /// <summary>对话内工作流没有 Code 项目作用域，只按本轮权限模式折算工具审批（plan/readonly/ask/auto/bypass）。</summary>
    private Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? CreatePermissionDecider(string? permissionMode)
    {
        if (!WorkToolPolicy.IsValidValue(permissionMode)) return null;
        return AgentToolPolicy.CreateDecider(
            _toolRegistry,
            new AgentPolicyContext { Mode = WorkToolPolicy.Parse(permissionMode) });
    }

    private async Task<(WorkToolScope? Scope, Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? DecideToolCall, string? Error, string? Notice)> PrepareWorkContextAsync(
        RunWorkflowRequest? request,
        CancellationToken cancellationToken)
    {
        if (request?.WorkSessionId is not Guid workSessionId)
            return (null, null, null, null);

        var session = await _unitOfWork.WorkSessions.GetByIdAsync(workSessionId, cancellationToken);
        if (session == null)
            return (null, null, _localizer.T("work.workSessionNotFound"), null);

        var project = await _unitOfWork.WorkProjects.GetByIdAsync(session.ProjectId, cancellationToken);
        if (project == null)
            return (null, null, _localizer.T("work.projectNotFound"), null);

        var worktreeResult = await _workSessionService.EnsureWorktreeAsync(workSessionId, request.Input, cancellationToken);
        var notice = worktreeResult.Success ? worktreeResult.Data : worktreeResult.Error;

        session = await _unitOfWork.WorkSessions.GetByIdAsync(workSessionId, cancellationToken) ?? session;
        var root = !string.IsNullOrWhiteSpace(session.WorktreePath) && Directory.Exists(session.WorktreePath)
            ? session.WorktreePath
            : project.RootPath;
        var runner = root == project.RootPath
            ? _commandRunnerFactory.Create(project)
            : new LocalCommandRunner(root);
        var mode = AgentModePolicy.Apply(
            request.AgentMode ?? session.AgentMode,
            WorkToolPolicy.Parse(request.PermissionMode ?? session.PermissionMode));
        var rules = await _unitOfWork.WorkApprovalRules.FindAsync(r => r.ProjectId == project.Id, cancellationToken);
        var scope = new WorkToolScope
        {
            ProjectRoot = root,
            ProjectId = project.Id,
            ModelId = request.ModelId ?? session.ModelId,
            DiagnosticsCommand = project.DiagnosticsCommand,
            Runner = runner
        };
        var decideToolCall = AgentToolPolicy.CreateDecider(
            _toolRegistry,
            new AgentPolicyContext { Mode = mode, Rules = rules });
        return (scope, decideToolCall, null, notice);
    }

    private static object MapRun(WorkflowRun r) => new
    {
        id = r.Id,
        workflowId = r.WorkflowId,
        status = r.Status,
        input = r.Input,
        output = r.Output,
        startedAt = r.StartedAt,
        completedAt = r.CompletedAt,
        chatTopicId = r.ChatTopicId,
        error = r.Error,
        totalIterations = r.TotalIterations,
        createdAt = r.CreatedAt
    };

    private static object MapRunNode(WorkflowRunNode n) => new
    {
        id = n.Id,
        runId = n.RunId,
        nodeId = n.NodeId,
        nodeType = n.NodeType,
        status = n.Status,
        input = n.Input,
        output = n.Output,
        startedAt = n.StartedAt,
        completedAt = n.CompletedAt,
        error = n.Error,
        iterations = n.Iterations
    };
}

public class ApproveRequest
{
    public string? NodeId { get; set; }
    public bool Approve { get; set; }
}

/// <summary>将工作流事件转发到 SSE 流</summary>
internal class SseWorkflowEventSink : IWorkflowEventSink
{
    private readonly SseStreamWriter _writer;

    public SseWorkflowEventSink(SseStreamWriter writer)
    {
        _writer = writer;
    }

    public Task OnRunStartedAsync(Guid runId, WorkflowDto workflow)
        => _writer.WriteJsonAsync(new { type = "run_started", runId, workflowId = workflow.Id, name = workflow.Name });

    public Task OnNodeStartedAsync(Guid runId, string nodeId, string nodeType, string label)
        => _writer.WriteJsonAsync(new { type = "node_started", runId, nodeId, nodeType, label });

    public Task OnNodeCompletedAsync(Guid runId, string nodeId, string output)
        => _writer.WriteJsonAsync(new { type = "node_completed", runId, nodeId, output });

    public Task OnNodeFailedAsync(Guid runId, string nodeId, string error)
        => _writer.WriteJsonAsync(new { type = "node_failed", runId, nodeId, error });

    public Task OnHumanApprovalRequiredAsync(Guid runId, string nodeId, string prompt)
        => _writer.WriteJsonAsync(new { type = "human_approval_required", runId, nodeId, prompt });

    public Task OnAgentToolCallAsync(Guid runId, string nodeId, string toolCallId, string name, string arguments)
        => _writer.WriteJsonAsync(new { type = "agent_tool_call", runId, nodeId, toolCallId, name, arguments });

    public Task OnAgentToolResultAsync(Guid runId, string nodeId, string toolCallId, string content, bool isError)
        => _writer.WriteJsonAsync(new { type = "agent_tool_result", runId, nodeId, toolCallId, content, isError });

    public Task OnRunCompletedAsync(Guid runId, string? output)
        => _writer.WriteJsonAsync(new { type = "run_completed", runId, output });

    public Task OnRunFailedAsync(Guid runId, string error)
        => _writer.WriteJsonAsync(new { type = "run_failed", runId, error });
}

