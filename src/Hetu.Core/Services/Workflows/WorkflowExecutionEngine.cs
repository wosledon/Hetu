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
    // Agent 节点内部工具调用事件（ask_question / 工具审批 / 普通工具）
    Task OnAgentToolCallAsync(Guid runId, string nodeId, string toolCallId, string name, string arguments) => Task.CompletedTask;
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

                var node = workflow.Nodes.FirstOrDefault(n => n.Id == currentNodeId);
                if (node == null) throw new InvalidOperationException($"节点 {currentNodeId} 不存在");

                var nodeResult = await ExecuteNodeAndRecordAsync(node, ctx, sink, run.Id, ct);

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

    /// <summary>
    /// 执行单个节点：检查迭代/访问上限、持久化运行记录、写入上下文、推送事件。
    /// 节点有多条出边（非条件/循环选择分支）时自动分路执行所有分支链路，并在汇聚点合并。
    /// </summary>
    private async Task<NodeResult> ExecuteNodeAndRecordAsync(NodeDto node, ExecutionContext ctx, IWorkflowEventSink? sink, Guid runId, CancellationToken ct)
    {
        if (ctx.TotalIterations >= ctx.MaxTotalIterations)
            throw new InvalidOperationException($"工作流超过全局迭代上限 {ctx.MaxTotalIterations}，疑似死循环");
        ctx.TotalIterations++;

        var visits = ctx.IncrementVisit(node.Id);
        if (visits > ctx.MaxNodeVisits && node.Type != WorkflowNodeTypes.Loop)
            throw new InvalidOperationException($"节点 {node.Label}({node.Id}) 被访问 {visits} 次，超过上限 {ctx.MaxNodeVisits}，疑似死循环");

        await (sink?.OnNodeStartedAsync(runId, node.Id, node.Type, node.Label) ?? Task.CompletedTask);

        var runNode = new WorkflowRunNode
        {
            Id = Guid.NewGuid(),
            RunId = runId,
            NodeId = node.Id,
            NodeType = node.Type,
            Status = "Running",
            StartedAt = DateTimeOffset.UtcNow,
            Iterations = visits,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        await _unitOfWork.WorkflowRunNodes.AddAsync(runNode, ct);

        var executor = GetExecutor(node.Type);
        var nodeResult = await executor.ExecuteAsync(node, ctx, ct, sink);

        // 先写入节点自身输出，保证分路分支执行时可读取上游输出
        ctx.SetVariable(node.Id, "output", nodeResult.Output ?? "");
        foreach (var kv in nodeResult.ExtraVariables)
            ctx.SetVariable(node.Id, kv.Key, kv.Value);

        // 自动分路：普通节点有多条出边（且非条件/循环的选择分支）时，执行所有分支链路
        var outgoing = ctx.Edges.Where(e => e.Source == node.Id).ToList();
        var isSelectiveBranch = !string.IsNullOrEmpty(nodeResult.BranchHandle);
        if (outgoing.Count > 1 && !isSelectiveBranch)
        {
            nodeResult = await ExecuteFanOutAsync(node, ctx, sink, runId, ct, nodeResult);
            // 覆盖分路后的输出（含合并结果）
            ctx.SetVariable(node.Id, "output", nodeResult.Output ?? "");
            foreach (var kv in nodeResult.ExtraVariables)
                ctx.SetVariable(node.Id, kv.Key, kv.Value);
        }

        runNode.Output = nodeResult.Output;
        runNode.CompletedAt = DateTimeOffset.UtcNow;

        if (nodeResult.Error != null)
        {
            runNode.Status = "Failed";
            runNode.Error = nodeResult.Error;
            await _unitOfWork.SaveChangesAsync(ct);
            await (sink?.OnNodeFailedAsync(runId, node.Id, nodeResult.Error) ?? Task.CompletedTask);
            throw new InvalidOperationException($"节点 {node.Label} 执行失败：{nodeResult.Error}");
        }

        runNode.Status = "Succeeded";
        await _unitOfWork.SaveChangesAsync(ct);
        await (sink?.OnNodeCompletedAsync(runId, node.Id, nodeResult.Output ?? "") ?? Task.CompletedTask);

        return nodeResult;
    }

    /// <summary>
    /// 分路执行节点的所有出边分支链路（顺序执行，共享 scoped DbContext 避免并发），
    /// 各分支输出汇总到 {nodeId}.branches；分支汇聚到公共后继后执行该合并节点一次。
    /// 合并节点自身若再分路，其完成状态（合并点/全分支完成）会传播到外层。
    /// </summary>
    private async Task<NodeResult> ExecuteFanOutAsync(NodeDto node, ExecutionContext ctx, IWorkflowEventSink? sink, Guid runId, CancellationToken ct, NodeResult nodeResult)
    {
        var branchEdges = ctx.Edges.Where(e => e.Source == node.Id).ToList();

        // 静态确定合并点：各分支路径的公共后继（可为任意普通节点，无需显式 Merge 块）
        var mergeNodeId = FindMergeNode(node, ctx);

        // 顺序执行所有分支链路
        var branchOutputs = new Dictionary<string, string>();
        foreach (var edge in branchEdges)
        {
            ct.ThrowIfCancellationRequested();
            var branchKey = edge.SourceHandle ?? edge.Target;
            var output = await ExecuteBranchPathAsync(edge.Target, mergeNodeId, ctx, sink, runId, ct);
            branchOutputs[branchKey] = output ?? "";
        }

        var branchesJson = JsonSerializer.Serialize(branchOutputs);
        ctx.SetVariable(node.Id, "branches", branchesJson);

        var result = new NodeResult
        {
            Output = nodeResult.Output ?? branchesJson,
            ExtraVariables = new Dictionary<string, string>(nodeResult.ExtraVariables)
        };

        // 执行合并节点（聚合所有分支输出）；合并节点自身的完成状态向上传播
        if (mergeNodeId != null)
        {
            var mergeNode = ctx.Nodes.FirstOrDefault(n => n.Id == mergeNodeId);
            // 合并点可能已被某个分支的嵌套分路消费，此时跳过执行仅记录合并点
            if (mergeNode != null && ctx.GetVisitCount(mergeNodeId) == 0)
            {
                var mergeResult = await ExecuteNodeAndRecordAsync(mergeNode, ctx, sink, runId, ct);
                result.Output = mergeResult.Output ?? branchesJson;
                foreach (var kv in mergeResult.ExtraVariables)
                    result.ExtraVariables[kv.Key] = kv.Value;
                // 合并节点未再分路时，显式记录合并点供主循环从其后继继续
                if (!result.ExtraVariables.ContainsKey("mergeNodeId") && !result.ExtraVariables.ContainsKey("__all_branches_done__"))
                    result.ExtraVariables["mergeNodeId"] = mergeNodeId;
            }
            else
            {
                result.ExtraVariables["mergeNodeId"] = mergeNodeId;
            }
        }
        else
        {
            // 无合并点：各分支独立结束，主循环不再继续
            result.ExtraVariables["__all_branches_done__"] = "true";
        }

        return result;
    }

    /// <summary>
    /// 执行单个分支的完整链路：从分支起始节点沿边前进，直到到达合并点 / End 节点 / 无出边。
    /// </summary>
    private async Task<string?> ExecuteBranchPathAsync(string startNodeId, string? mergeNodeId, ExecutionContext ctx, IWorkflowEventSink? sink, Guid runId, CancellationToken ct)
    {
        string? currentId = startNodeId;
        string? lastOutput = null;
        var visited = new HashSet<string>();

        while (currentId != null && visited.Add(currentId))
        {
            ct.ThrowIfCancellationRequested();

            // 到达合并点：本分支在此结束
            if (mergeNodeId != null && currentId == mergeNodeId)
                break;

            var node = ctx.Nodes.FirstOrDefault(n => n.Id == currentId);
            if (node == null) break;

            // 分支内遇到 Merge 节点：作为本分支的合并点
            if (node.Type == WorkflowNodeTypes.Merge)
                break;

            var r = await ExecuteNodeAndRecordAsync(node, ctx, sink, runId, ct);
            lastOutput = r.Output;

            if (r.ShouldEnd) return lastOutput;

            // 节点内部发生分路：其合并点已由内部执行，本分支止步，由外层统一从合并点后继继续
            if (r.ExtraVariables.ContainsKey("mergeNodeId") || r.ExtraVariables.ContainsKey("__all_branches_done__"))
                return lastOutput;

            currentId = GetNextNodeId(node, r, ctx);
        }

        return lastOutput;
    }

    /// <summary>
    /// 静态确定分支的合并点：被 ≥2 个分支可达的公共节点（可为任意普通节点，无需显式 Merge 块）。
    /// 优先显式 Merge 节点，否则取"最近"公共后继（不被其他候选合并点可达的最小节点）。
    /// 无公共后继（各分支独立结束）时返回 null。
    /// </summary>
    private static string? FindMergeNode(NodeDto node, ExecutionContext ctx)
    {
        var branchStarts = ctx.Edges.Where(e => e.Source == node.Id).Select(e => e.Target).Distinct().ToList();
        if (branchStarts.Count < 2) return null;

        // 每个分支的可达节点集合（沿出边 BFS）
        var branchReachable = branchStarts.Select(start =>
        {
            var reachable = new HashSet<string> { start };
            var queue = new Queue<string>();
            queue.Enqueue(start);
            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                foreach (var e in ctx.Edges.Where(edge => edge.Source == cur))
                {
                    if (reachable.Add(e.Target)) queue.Enqueue(e.Target);
                }
            }
            return reachable;
        }).ToList();

        // 被 ≥2 个分支可达的节点作为候选合并点
        var candidates = ctx.Nodes
            .Select(n => n.Id)
            .Where(nodeId => branchReachable.Count(set => set.Contains(nodeId)) >= 2)
            .ToList();
        if (candidates.Count == 0) return null;

        // 优先显式 Merge 节点
        var explicitMerge = candidates.FirstOrDefault(c => ctx.Nodes.First(n => n.Id == c).Type == WorkflowNodeTypes.Merge);
        if (explicitMerge != null) return explicitMerge;

        // 否则取"最近"公共后继：不被其他候选可达的最小节点（如 A/B→C→End 时应取 C 而非 End）
        var nearest = candidates
            .Where(c => !candidates.Any(other => other != c && IsReachable(other, c, ctx)))
            .ToList();
        return nearest.FirstOrDefault();
    }

    /// <summary>判断 from 节点是否可沿出边到达 to 节点</summary>
    private static bool IsReachable(string from, string to, ExecutionContext ctx)
    {
        if (from == to) return false;
        var visited = new HashSet<string> { from };
        var queue = new Queue<string>();
        queue.Enqueue(from);
        while (queue.Count > 0)
        {
            var cur = queue.Dequeue();
            foreach (var e in ctx.Edges.Where(edge => edge.Source == cur))
            {
                if (e.Target == to) return true;
                if (visited.Add(e.Target)) queue.Enqueue(e.Target);
            }
        }
        return false;
    }

    /// <summary>确定下一节点 ID</summary>
    private static string? GetNextNodeId(NodeDto node, NodeResult result, ExecutionContext ctx)
    {
        var outgoing = ctx.Edges.Where(e => e.Source == node.Id).ToList();
        if (outgoing.Count == 0) return null;

        // 分路后无合并点：所有分支已独立执行结束，主循环终止
        if (result.ExtraVariables.ContainsKey("__all_branches_done__"))
            return null;

        // 分路后已执行合并节点：从合并节点的后继继续
        if (result.ExtraVariables.TryGetValue("mergeNodeId", out var mergeId) && !string.IsNullOrEmpty(mergeId))
        {
            var mergeOutgoing = ctx.Edges.Where(e => e.Source == mergeId).ToList();
            return mergeOutgoing.FirstOrDefault(e => string.IsNullOrEmpty(e.SourceHandle))?.Target
                   ?? mergeOutgoing.FirstOrDefault()?.Target;
        }

        // 有分支 handle：匹配 sourceHandle（条件/循环的选择分支）
        if (!string.IsNullOrEmpty(result.BranchHandle))
        {
            var matched = outgoing.FirstOrDefault(e => string.Equals(e.SourceHandle, result.BranchHandle, StringComparison.OrdinalIgnoreCase));
            if (matched != null) return matched.Target;
            // 回退到默认（无 handle 的边）
            matched = outgoing.FirstOrDefault(e => string.IsNullOrEmpty(e.SourceHandle));
            return matched?.Target;
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
