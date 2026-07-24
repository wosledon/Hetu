using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Workflow;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

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
}

/// <summary>
/// 工作流执行引擎。负责加载工作流定义、创建运行实例、按图遍历执行节点、
/// 处理分支/循环/并行/子工作流，写入运行记录，并通过 IWorkflowEventSink 推送事件。
/// </summary>
public class WorkflowExecutionEngine
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IEnumerable<INodeExecutor> _nodeExecutors;
    private readonly ILogger<WorkflowExecutionEngine> _logger;
    private readonly Dictionary<string, INodeExecutor> _executorByType;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public WorkflowExecutionEngine(
        IUnitOfWork unitOfWork,
        IEnumerable<INodeExecutor> nodeExecutors,
        ILogger<WorkflowExecutionEngine> logger)
    {
        _unitOfWork = unitOfWork;
        _nodeExecutors = nodeExecutors;
        _logger = logger;
        _executorByType = nodeExecutors.ToDictionary(e => e.NodeType, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>按工作流 ID 执行</summary>
    public async Task<WorkflowRunResult> ExecuteAsync(Guid workflowId, string? input, CancellationToken ct, int depth = 0, IWorkflowEventSink? sink = null, Guid? chatTopicId = null)
    {
        var wf = await _unitOfWork.Workflows.GetByIdAsync(workflowId, ct);
        if (wf == null) return new WorkflowRunResult { Status = "Failed", Error = "工作流不存在" };
        if (!wf.IsEnabled) return new WorkflowRunResult { Status = "Failed", Error = "工作流已禁用" };

        var dto = Map(wf);
        return await ExecuteAsync(dto, input, ct, depth, sink, chatTopicId);
    }

    /// <summary>按工作流 DTO 执行（支持传入未持久化的定义）</summary>
    public async Task<WorkflowRunResult> ExecuteAsync(WorkflowDto workflow, string? input, CancellationToken ct, int depth = 0, IWorkflowEventSink? sink = null, Guid? chatTopicId = null)
    {
        var validation = WorkflowService.ValidateGraph(workflow);
        if (!validation.Valid)
            return new WorkflowRunResult { Status = "Failed", Error = "工作流校验失败：" + string.Join("; ", validation.Errors) };

        // 创建运行实例
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
            MaxTotalIterations = 100,
            MaxNodeVisits = 20
        };
        ctx.SetVariable("__depth", "value", depth);

        var result = new WorkflowRunResult { RunId = run.Id };

        try
        {
            var startNode = workflow.Nodes.FirstOrDefault(n => n.Type == WorkflowNodeTypes.Start)
                ?? throw new InvalidOperationException("找不到 Start 节点");

            string? currentNodeId = startNode.Id;
            var endOutput = (string?)null;

            while (currentNodeId != null)
            {
                ct.ThrowIfCancellationRequested();

                if (ctx.TotalIterations >= ctx.MaxTotalIterations)
                    throw new InvalidOperationException($"工作流超过全局迭代上限 {ctx.MaxTotalIterations}，疑似死循环");
                ctx.TotalIterations++;

                var node = workflow.Nodes.FirstOrDefault(n => n.Id == currentNodeId);
                if (node == null) throw new InvalidOperationException($"节点 {currentNodeId} 不存在");

                var visits = ctx.IncrementVisit(node.Id);
                if (visits > ctx.MaxNodeVisits && node.Type != WorkflowNodeTypes.Loop)
                    throw new InvalidOperationException($"节点 {node.Label}({node.Id}) 被访问 {visits} 次，超过上限 {ctx.MaxNodeVisits}，疑似死循环");

                await (sink?.OnNodeStartedAsync(run.Id, node.Id, node.Type, node.Label) ?? Task.CompletedTask);

                var runNode = new WorkflowRunNode
                {
                    Id = Guid.NewGuid(),
                    RunId = run.Id,
                    NodeId = node.Id,
                    NodeType = node.Type,
                    Status = "Running",
                    StartedAt = DateTimeOffset.UtcNow,
                    Iterations = visits,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow
                };
                await _unitOfWork.WorkflowRunNodes.AddAsync(runNode, ct);

                NodeResult nodeResult;
                if (node.Type == WorkflowNodeTypes.Parallel)
                {
                    nodeResult = await ExecuteParallelAsync(node, ctx, sink, run.Id, ct);
                }
                else
                {
                    var executor = GetExecutor(node.Type);
                    nodeResult = await executor.ExecuteAsync(node, ctx, ct);
                }

                // 存储输出到上下文
                ctx.SetVariable(node.Id, "output", nodeResult.Output ?? "");
                foreach (var kv in nodeResult.ExtraVariables)
                    ctx.SetVariable(node.Id, kv.Key, kv.Value);

                runNode.Output = nodeResult.Output;
                runNode.CompletedAt = DateTimeOffset.UtcNow;

                if (nodeResult.Error != null)
                {
                    runNode.Status = "Failed";
                    runNode.Error = nodeResult.Error;
                    await _unitOfWork.SaveChangesAsync(ct);
                    await (sink?.OnNodeFailedAsync(run.Id, node.Id, nodeResult.Error) ?? Task.CompletedTask);
                    throw new InvalidOperationException($"节点 {node.Label} 执行失败：{nodeResult.Error}");
                }

                runNode.Status = "Succeeded";
                await _unitOfWork.SaveChangesAsync(ct);
                await (sink?.OnNodeCompletedAsync(run.Id, node.Id, nodeResult.Output ?? "") ?? Task.CompletedTask);

                if (nodeResult.ShouldEnd)
                {
                    endOutput = nodeResult.Output;
                    break;
                }

                // 确定下一节点
                currentNodeId = GetNextNodeId(node, nodeResult, ctx);
            }

            run.Status = "Succeeded";
            run.Output = endOutput ?? "";
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.TotalIterations = ctx.TotalIterations;
            result.Status = "Succeeded";
            result.Output = endOutput;
            await _unitOfWork.SaveChangesAsync(ct);
            await (sink?.OnRunCompletedAsync(run.Id, endOutput) ?? Task.CompletedTask);
        }
        catch (OperationCanceledException)
        {
            run.Status = "Cancelled";
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.TotalIterations = ctx.TotalIterations;
            await _unitOfWork.SaveChangesAsync(ct);
            result.Status = "Cancelled";
            await (sink?.OnRunFailedAsync(run.Id, "工作流执行被取消") ?? Task.CompletedTask);
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
            await (sink?.OnRunFailedAsync(run.Id, ex.Message) ?? Task.CompletedTask);
        }

        return result;
    }

    /// <summary>并行执行所有分支目标节点，收集结果</summary>
    private async Task<NodeResult> ExecuteParallelAsync(NodeDto parallelNode, ExecutionContext ctx, IWorkflowEventSink? sink, Guid runId, CancellationToken ct)
    {
        var branchEdges = ctx.Edges.Where(e => e.Source == parallelNode.Id).ToList();
        if (branchEdges.Count == 0)
            return new NodeResult { Output = "{}" };

        var branchTasks = branchEdges.Select(async edge =>
        {
            var target = ctx.Nodes.FirstOrDefault(n => n.Id == edge.Target);
            if (target == null) return (edge.SourceHandle ?? edge.Target, (string?)"节点不存在", true);

            await (sink?.OnNodeStartedAsync(runId, target.Id, target.Type, target.Label) ?? Task.CompletedTask);
            var executor = GetExecutor(target.Type);
            var r = await executor.ExecuteAsync(target, ctx, ct);
            ctx.SetVariable(target.Id, "output", r.Output ?? "");
            await (sink?.OnNodeCompletedAsync(runId, target.Id, r.Output ?? "") ?? Task.CompletedTask);
            return (edge.SourceHandle ?? edge.Target, r.Output, r.Error != null);
        }).ToList();

        var results = await Task.WhenAll(branchTasks);
        var dict = results.ToDictionary(r => r.Item1, r => r.Item2 ?? "");
        var json = JsonSerializer.Serialize(dict);
        return new NodeResult { Output = json };
    }

    /// <summary>确定下一节点 ID</summary>
    private static string? GetNextNodeId(NodeDto node, NodeResult result, ExecutionContext ctx)
    {
        var outgoing = ctx.Edges.Where(e => e.Source == node.Id).ToList();
        if (outgoing.Count == 0) return null;

        // 有分支 handle：匹配 sourceHandle
        if (!string.IsNullOrEmpty(result.BranchHandle) && result.BranchHandle != "__parallel_fanout__")
        {
            var matched = outgoing.FirstOrDefault(e => string.Equals(e.SourceHandle, result.BranchHandle, StringComparison.OrdinalIgnoreCase));
            if (matched != null) return matched.Target;
            // 回退到默认（无 handle 的边）
            matched = outgoing.FirstOrDefault(e => string.IsNullOrEmpty(e.SourceHandle));
            return matched?.Target;
        }

        // Parallel 节点：找 join 点（所有分支目标的共同后继）
        if (node.Type == WorkflowNodeTypes.Parallel)
        {
            var branchTargets = outgoing.Select(e => e.Target).ToHashSet();
            var nextNodes = ctx.Edges
                .Where(e => branchTargets.Contains(e.Source))
                .Select(e => e.Target)
                .Distinct()
                .ToList();
            if (nextNodes.Count == 1) return nextNodes[0];
            // 无明确 join 点，尝试 parallel 节点的 handle="join" 边
            var joinEdge = outgoing.FirstOrDefault(e => string.Equals(e.SourceHandle, "join", StringComparison.OrdinalIgnoreCase));
            return joinEdge?.Target ?? nextNodes.FirstOrDefault();
        }

        // 默认：第一条出边（优先无 handle 的）
        return outgoing.FirstOrDefault(e => string.IsNullOrEmpty(e.SourceHandle))?.Target
               ?? outgoing[0].Target;
    }

    private INodeExecutor GetExecutor(string nodeType)
    {
        if (_executorByType.TryGetValue(nodeType, out var executor))
            return executor;
        throw new InvalidOperationException($"不支持的节点类型：{nodeType}");
    }

    private static WorkflowDto Map(Workflow w) => new()
    {
        Id = w.Id,
        Name = w.Name,
        Description = w.Description,
        Nodes = WorkflowService.Deserialize<List<NodeDto>>(w.Nodes) ?? new(),
        Edges = WorkflowService.Deserialize<List<EdgeDto>>(w.Edges) ?? new(),
        InputSchema = w.InputSchema,
        Variables = w.Variables,
        Version = w.Version,
        IsEnabled = w.IsEnabled,
        SortOrder = w.SortOrder,
        CreatedAt = w.CreatedAt,
        UpdatedAt = w.UpdatedAt
    };
}
