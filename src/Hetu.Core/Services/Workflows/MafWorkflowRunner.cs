using System.Diagnostics;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Utilities;
using Hetu.Shared.Workflow;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.Logging;
using MafWorkflow = Microsoft.Agents.AI.Workflows.Workflow;
using HetuWorkflow = Hetu.Core.Entities.Workflow;

namespace Hetu.Core.Services.Workflows;

/// <summary>工作流执行结果</summary>
public class WorkflowRunResult
{
    public Guid RunId { get; set; }
    public string Status { get; set; } = "Pending";
    public string? Output { get; set; }
    public string? Error { get; set; }
    public int TotalIterations { get; set; }
}

/// <summary>工作流事件接收器（SSE 流式输出用）</summary>
public interface IWorkflowEventSink
{
    Task OnRunStartedAsync(Guid runId, WorkflowDto workflow) => Task.CompletedTask;
    Task OnNodeStartedAsync(Guid runId, string nodeId, string nodeType, string label) => Task.CompletedTask;
    Task OnNodeCompletedAsync(Guid runId, string nodeId, string output) => Task.CompletedTask;
    Task OnNodeFailedAsync(Guid runId, string nodeId, string error) => Task.CompletedTask;
    Task OnHumanApprovalRequiredAsync(Guid runId, string nodeId, string prompt) => Task.CompletedTask;
    Task OnRunCompletedAsync(Guid runId, string? output) => Task.CompletedTask;
    Task OnRunFailedAsync(Guid runId, string error) => Task.CompletedTask;
    Task OnAgentToolCallAsync(Guid runId, string nodeId, string toolCallId, string name, string arguments) => Task.CompletedTask;
    Task OnAgentToolResultAsync(Guid runId, string nodeId, string toolCallId, string content, bool isError) => Task.CompletedTask;
}

/// <summary>
/// 基于 Microsoft Agent Framework Workflows 的工作流执行器。
/// Hetu 只保留节点业务逻辑、运行记录与 SSE 适配，图遍历、分支、分路和循环由 MAF 负责。
/// </summary>
public sealed class MafWorkflowRunner
{
    private static readonly ActivitySource ActivitySource = new("Hetu.Workflows");
    private readonly IUnitOfWork _unitOfWork;
    private readonly IReadOnlyDictionary<string, INodeExecutor> _executorByType;
    private readonly ILogger<MafWorkflowRunner> _logger;
    private readonly ILocalizer _localizer;
    private readonly WorkflowApprovalService _approvalService;
    private readonly CheckpointManager _checkpointManager;

    public MafWorkflowRunner(
        IUnitOfWork unitOfWork,
        IEnumerable<INodeExecutor> nodeExecutors,
        ILogger<MafWorkflowRunner> logger,
        ILocalizer localizer,
        WorkflowApprovalService approvalService,
        CheckpointManager checkpointManager)
    {
        _unitOfWork = unitOfWork;
        _executorByType = nodeExecutors.ToDictionary(executor => executor.NodeType, StringComparer.OrdinalIgnoreCase);
        _logger = logger;
        _localizer = localizer;
        _approvalService = approvalService;
        _checkpointManager = checkpointManager;
    }

    public async Task<WorkflowRunResult> ExecuteAsync(
        Guid workflowId,
        string? input,
        CancellationToken ct,
        int depth = 0,
        IWorkflowEventSink? sink = null,
        Guid? chatTopicId = null,
        Func<LlmToolCall, Task<string>>? questionHandler = null,
        WorkToolScope? workScope = null,
        Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? decideToolCall = null)
    {
        var workflow = await _unitOfWork.Workflows.GetByIdAsync(workflowId, ct);
        if (workflow == null)
            return new WorkflowRunResult { Status = "Failed", Error = _localizer.T("workflow.notFound") };
        if (!workflow.IsEnabled)
            return new WorkflowRunResult { Status = "Failed", Error = _localizer.T("workflow.disabled") };

        return await ExecuteAsync(Map(workflow), input, ct, depth, sink, chatTopicId, questionHandler, workScope, decideToolCall);
    }

    public async Task<WorkflowRunResult> ExecuteAsync(
        WorkflowDto workflow,
        string? input,
        CancellationToken ct,
        int depth = 0,
        IWorkflowEventSink? sink = null,
        Guid? chatTopicId = null,
        Func<LlmToolCall, Task<string>>? questionHandler = null,
        WorkToolScope? workScope = null,
        Func<LlmToolCall, ToolApprovalMode, Task<WorkToolDecision>>? decideToolCall = null)
    {
        var validation = WorkflowService.ValidateGraph(workflow, _localizer);
        if (!validation.Valid)
            return new WorkflowRunResult { Status = "Failed", Error = _localizer.T("workflow.validationFailed", string.Join("; ", validation.Errors)) };

        var run = new WorkflowRun
        {
            Id = Guid.NewGuid(),
            WorkflowId = workflow.Id,
            Status = "Running",
            Input = input,
            GraphSnapshot = JsonSerializer.Serialize(workflow),
            StartedAt = DateTimeOffset.UtcNow,
            ChatTopicId = chatTopicId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        await _unitOfWork.WorkflowRuns.AddAsync(run, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        await (sink?.OnRunStartedAsync(run.Id, workflow) ?? Task.CompletedTask);

        var ctx = new ExecutionContext
        {
            RunId = run.Id,
            Input = input,
            Nodes = workflow.Nodes,
            Edges = workflow.Edges,
            QuestionHandler = questionHandler,
            WorkScope = workScope,
            DecideToolCall = decideToolCall,
            MaxTotalIterations = 100,
            MaxNodeVisits = 20
        };
        ctx.SetVariable("__depth", "value", depth);

        var state = new WorkflowState();
        using var activity = ActivitySource.StartActivity("hetu.workflow.run");
        activity?.SetTag("hetu.workflow.id", workflow.Id.ToString());
        activity?.SetTag("hetu.workflow.run_id", run.Id.ToString());
        var result = new WorkflowRunResult { RunId = run.Id };
        try
        {
            var mafWorkflow = BuildWorkflow(workflow, ctx, state, sink);
            await using var mafRun = await InProcessExecution.RunStreamingAsync(
                mafWorkflow,
                input ?? string.Empty,
                _checkpointManager,
                run.Id.ToString(),
                ct);
            await foreach (var workflowEvent in mafRun.WatchStreamAsync(ct))
            {
                if (workflowEvent is WorkflowErrorEvent workflowError)
                    throw new InvalidOperationException(workflowError.Exception?.GetBaseException().Message ?? workflowError.Data?.ToString() ?? "Workflow execution failed.");
                if (workflowEvent is RequestInfoEvent requestInfo)
                    await HandleHumanApprovalAsync(requestInfo.Request, ctx, state, sink, mafRun, ct);
            }

            run.Status = "Succeeded";
            run.Output = state.FinalOutput ?? string.Empty;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.TotalIterations = ctx.TotalIterations;
            result.Status = "Succeeded";
            result.Output = state.FinalOutput;
            result.TotalIterations = ctx.TotalIterations;
            await _unitOfWork.SaveChangesAsync(ct);
            await (sink?.OnRunCompletedAsync(run.Id, state.FinalOutput) ?? Task.CompletedTask);
        }
        catch (OperationCanceledException)
        {
            run.Status = "Cancelled";
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.TotalIterations = ctx.TotalIterations;
            await _unitOfWork.SaveChangesAsync(CancellationToken.None);
            result.Status = "Cancelled";
            result.TotalIterations = ctx.TotalIterations;
            await (sink?.OnRunFailedAsync(run.Id, _localizer.T("workflow.runCancelled")) ?? Task.CompletedTask);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "工作流 {WorkflowId} 执行失败", workflow.Id);
            run.Status = "Failed";
            run.Error = ex.Message;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.TotalIterations = ctx.TotalIterations;
            await _unitOfWork.SaveChangesAsync(ct);
            result.Status = "Failed";
            result.Error = ex.Message;
            result.TotalIterations = ctx.TotalIterations;
            await (sink?.OnRunFailedAsync(run.Id, ex.Message) ?? Task.CompletedTask);
        }
        return result;
    }

    private MafWorkflow BuildWorkflow(
        WorkflowDto workflow,
        ExecutionContext ctx,
        WorkflowState state,
        IWorkflowEventSink? sink)
    {
        var bindings = new Dictionary<string, ExecutorBinding>(StringComparer.Ordinal);
        var humanAdapters = new Dictionary<string, ExecutorBinding>(StringComparer.Ordinal);
        foreach (var node in workflow.Nodes)
        {
            if (node.Type == WorkflowNodeTypes.Human)
            {
                state.HumanNodes[node.Id] = node;
                var port = RequestPort.Create<WorkflowNodeResult, bool>(node.Id);
                bindings[node.Id] = port.BindAsExecutor();
                humanAdapters[node.Id] = ExecutorBindingExtensions.BindAsExecutor<bool, WorkflowNodeResult>(
                    async (approved, _, token) => await CompleteHumanApprovalAsync(node, approved, ctx, state, sink, token),
                    $"{node.Id}-resume", ExecutorOptions.Default, threadsafe: false);
                continue;
            }

            bindings[node.Id] = node.Type == WorkflowNodeTypes.Start
                ? ExecutorBindingExtensions.BindAsExecutor<string, WorkflowNodeResult>(
                    async (input, _, token) => await ExecuteNodeAsync(node, ctx, state, sink, input, token),
                    node.Id, ExecutorOptions.Default, threadsafe: false)
                : ExecutorBindingExtensions.BindAsExecutor<WorkflowNodeResult, WorkflowNodeResult>(
                    async (_, _, token) => await ExecuteNodeAsync(node, ctx, state, sink, null, token),
                    node.Id, ExecutorOptions.Default, threadsafe: false);
        }

        ExecutorBinding Source(string nodeId) => humanAdapters.TryGetValue(nodeId, out var adapter) ? adapter : bindings[nodeId];
        ExecutorBinding Target(string nodeId) => bindings[nodeId];

        var start = bindings[workflow.Nodes.First(node => node.Type == WorkflowNodeTypes.Start).Id];
        var builder = new WorkflowBuilder(start);
        foreach (var node in workflow.Nodes.Where(node => node.Type == WorkflowNodeTypes.Human))
            builder.AddEdge<bool>(bindings[node.Id], humanAdapters[node.Id], condition: null, idempotent: true);
        var mergeNodes = new HashSet<string>(
            workflow.Nodes.Where(node => node.Type == WorkflowNodeTypes.Merge).Select(node => node.Id),
            StringComparer.Ordinal);

        foreach (var edge in workflow.Edges)
        {
            if (mergeNodes.Contains(edge.Target)) continue;
            builder.AddEdge<WorkflowNodeResult>(
                Source(edge.Source),
                Target(edge.Target),
                nodeResult => ShouldFollow(edge, nodeResult),
                edge.SourceHandle ?? edge.Id,
                idempotent: true);
        }

        foreach (var merge in mergeNodes)
        {
            var sources = workflow.Edges.Where(edge => edge.Target == merge)
                .Select(edge => Source(edge.Source))
                .Distinct()
                .ToList();
            if (sources.Count > 1)
                builder.AddFanInBarrierEdge(sources, Target(merge));
            else if (sources.Count == 1)
                builder.AddEdge<WorkflowNodeResult>(sources[0], Target(merge), label: null, idempotent: true);
        }

        return builder.Build(validateOrphans: true);
    }

    private async Task HandleHumanApprovalAsync(
        ExternalRequest request,
        ExecutionContext ctx,
        WorkflowState state,
        IWorkflowEventSink? sink,
        StreamingRun run,
        CancellationToken ct)
    {
        var node = state.HumanNodes.TryGetValue(request.PortInfo.PortId, out var humanNode)
            ? humanNode
            : throw new InvalidOperationException(_localizer.T("workflow.unsupportedNodeType", request.PortInfo.PortId));
        var (prompt, timeoutSeconds) = ReadHumanConfig(node);
        var visits = ctx.IncrementVisit(node.Id);
        ctx.TotalIterations++;
        var runNode = new WorkflowRunNode
        {
            Id = Guid.NewGuid(),
            RunId = ctx.RunId,
            NodeId = node.Id,
            NodeType = node.Type,
            Status = "Running",
            StartedAt = DateTimeOffset.UtcNow,
            Iterations = visits,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        state.HumanRunNodes[node.Id] = runNode;
        await _unitOfWork.WorkflowRunNodes.AddAsync(runNode, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        await (sink?.OnNodeStartedAsync(ctx.RunId, node.Id, node.Type, node.Label) ?? Task.CompletedTask);
        await (sink?.OnHumanApprovalRequiredAsync(ctx.RunId, node.Id, prompt) ?? Task.CompletedTask);

        var pending = await _approvalService.WaitForApprovalAsync(
            ctx.RunId.ToString(),
            node.Id,
            prompt,
            TimeSpan.FromSeconds(timeoutSeconds));
        bool approved;
        try
        {
            approved = await pending.Task.WaitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            _approvalService.ClearRun(ctx.RunId.ToString());
            throw;
        }
        await run.SendResponseAsync(request.CreateResponse(approved));
    }

    private async Task<WorkflowNodeResult> CompleteHumanApprovalAsync(
        NodeDto node,
        bool approved,
        ExecutionContext ctx,
        WorkflowState state,
        IWorkflowEventSink? sink,
        CancellationToken ct)
    {
        var runNode = state.HumanRunNodes[node.Id];
        runNode.CompletedAt = DateTimeOffset.UtcNow;
        runNode.UpdatedAt = DateTimeOffset.UtcNow;
        if (!approved)
        {
            runNode.Status = "Failed";
            runNode.Error = _localizer.T("workflowNode.approvalRejected");
            await _unitOfWork.SaveChangesAsync(ct);
            await (sink?.OnNodeFailedAsync(ctx.RunId, node.Id, runNode.Error) ?? Task.CompletedTask);
            throw new InvalidOperationException(_localizer.T("workflow.nodeFailed", node.Label, runNode.Error));
        }

        var output = _localizer.T("workflowNode.approvalApproved");
        runNode.Status = "Succeeded";
        runNode.Output = output;
        ctx.SetVariable(node.Id, "output", output);
        await _unitOfWork.SaveChangesAsync(ct);
        await (sink?.OnNodeCompletedAsync(ctx.RunId, node.Id, output) ?? Task.CompletedTask);
        return new WorkflowNodeResult(node.Id, output, "approved", false);
    }

    private (string Prompt, int TimeoutSeconds) ReadHumanConfig(NodeDto node)
    {
        var prompt = _localizer.T("workflowNode.defaultApprovalPrompt");
        var timeoutSeconds = 300;
        if (string.IsNullOrWhiteSpace(node.Config)) return (prompt, timeoutSeconds);
        try
        {
            using var document = JsonDocument.Parse(node.Config);
            if (document.RootElement.ValueKind == JsonValueKind.Object)
            {
                if (document.RootElement.TryGetProperty("prompt", out var promptElement)
                    && promptElement.ValueKind == JsonValueKind.String)
                    prompt = promptElement.GetString() ?? prompt;
                if (document.RootElement.TryGetProperty("timeoutSeconds", out var timeoutElement)
                    && timeoutElement.TryGetInt32(out var parsedTimeout))
                    timeoutSeconds = parsedTimeout;
            }
        }
        catch (JsonException)
        {
        }
        return (prompt, timeoutSeconds);
    }

    private async Task<WorkflowNodeResult> ExecuteNodeAsync(
        NodeDto node,
        ExecutionContext ctx,
        WorkflowState state,
        IWorkflowEventSink? sink,
        string? input,
        CancellationToken ct)
    {
        if (ctx.TotalIterations >= ctx.MaxTotalIterations)
            throw new InvalidOperationException(_localizer.T("workflow.globalIterationLimit", ctx.MaxTotalIterations));
        ctx.TotalIterations++;
        var visits = ctx.IncrementVisit(node.Id);
        if (visits > ctx.MaxNodeVisits && node.Type != WorkflowNodeTypes.Loop)
            throw new InvalidOperationException(_localizer.T("workflow.nodeVisitLimit", node.Label, node.Id, visits));

        await (sink?.OnNodeStartedAsync(ctx.RunId, node.Id, node.Type, node.Label) ?? Task.CompletedTask);
        using var activity = ActivitySource.StartActivity("hetu.workflow.node");
        activity?.SetTag("hetu.workflow.node_id", node.Id);
        activity?.SetTag("hetu.workflow.node_type", node.Type);
        var runNode = new WorkflowRunNode
        {
            Id = Guid.NewGuid(),
            RunId = ctx.RunId,
            NodeId = node.Id,
            NodeType = node.Type,
            Status = "Running",
            StartedAt = DateTimeOffset.UtcNow,
            Iterations = visits,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        await _unitOfWork.WorkflowRunNodes.AddAsync(runNode, ct);

        if (node.Type == WorkflowNodeTypes.Start)
            ctx.Input = input ?? string.Empty;
        var executor = _executorByType.TryGetValue(node.Type, out var resolved)
            ? resolved
            : throw new InvalidOperationException(_localizer.T("workflow.unsupportedNodeType", node.Type));
        var nodeResult = await executor.ExecuteAsync(node, ctx, ct, sink);

        ctx.SetVariable(node.Id, "output", nodeResult.Output ?? string.Empty);
        foreach (var variable in nodeResult.ExtraVariables)
            ctx.SetVariable(node.Id, variable.Key, variable.Value);

        runNode.Output = nodeResult.Output;
        runNode.CompletedAt = DateTimeOffset.UtcNow;
        if (nodeResult.Error != null)
        {
            runNode.Status = "Failed";
            runNode.Error = nodeResult.Error;
            await _unitOfWork.SaveChangesAsync(ct);
            await (sink?.OnNodeFailedAsync(ctx.RunId, node.Id, nodeResult.Error) ?? Task.CompletedTask);
            throw new InvalidOperationException(_localizer.T("workflow.nodeFailed", node.Label, nodeResult.Error));
        }

        runNode.Status = "Succeeded";
        await _unitOfWork.SaveChangesAsync(ct);
        await (sink?.OnNodeCompletedAsync(ctx.RunId, node.Id, nodeResult.Output ?? string.Empty) ?? Task.CompletedTask);
        if (nodeResult.ShouldEnd)
            state.FinalOutput = nodeResult.Output;
        return new WorkflowNodeResult(node.Id, nodeResult.Output, nodeResult.BranchHandle, nodeResult.ShouldEnd);
    }

    private static bool ShouldFollow(EdgeDto edge, WorkflowNodeResult? result)
    {
        if (result == null) return false;
        if (string.IsNullOrEmpty(edge.SourceHandle))
            return string.IsNullOrEmpty(result.BranchHandle) || string.Equals(result.BranchHandle, "default", StringComparison.OrdinalIgnoreCase);
        return string.Equals(result.BranchHandle, edge.SourceHandle, StringComparison.OrdinalIgnoreCase);
    }

    private static WorkflowDto Map(HetuWorkflow workflow) => new()
    {
        Id = workflow.Id,
        Name = workflow.Name,
        Description = workflow.Description,
        Nodes = WorkflowService.Deserialize<List<NodeDto>>(workflow.Nodes) ?? new(),
        Edges = WorkflowService.Deserialize<List<EdgeDto>>(workflow.Edges) ?? new(),
        InputSchema = workflow.InputSchema,
        Variables = workflow.Variables,
        Version = workflow.Version,
        IsEnabled = workflow.IsEnabled,
        SortOrder = workflow.SortOrder,
        CreatedAt = workflow.CreatedAt,
        UpdatedAt = workflow.UpdatedAt
    };

    private sealed record WorkflowNodeResult(string NodeId, string? Output, string? BranchHandle, bool ShouldEnd);

    private sealed class WorkflowState
    {
        public string? FinalOutput { get; set; }
        public Dictionary<string, NodeDto> HumanNodes { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, WorkflowRunNode> HumanRunNodes { get; } = new(StringComparer.Ordinal);
    }
}
