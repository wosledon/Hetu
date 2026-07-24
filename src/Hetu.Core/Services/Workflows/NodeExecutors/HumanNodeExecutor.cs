using System.Text.Json;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows.NodeExecutors;

/// <summary>
/// Human 节点：暂停等待人工审批。通过 WorkflowApprovalService 阻塞，直到用户确认或超时。
/// 配置 JSON: { "prompt": "确认执行吗？", "timeoutSeconds": 300 }
/// 审批通过 → 继续；拒绝/超时 → 返回错误（或走 "rejected" 分支）。
/// </summary>
public class HumanNodeExecutor : INodeExecutor
{
    private readonly WorkflowApprovalService _approvalService;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public HumanNodeExecutor(WorkflowApprovalService approvalService)
    {
        _approvalService = approvalService;
    }

    public string NodeType => WorkflowNodeTypes.Human;

    public async Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct)
    {
        var config = ParseConfig(node.Config);
        var prompt = config?.TryGetValue("prompt", out var p) == true ? p?.ToString() : "请确认是否继续执行";
        var timeoutSeconds = 300;
        if (config?.TryGetValue("timeoutSeconds", out var ts) == true && int.TryParse(ts?.ToString(), out var t))
            timeoutSeconds = t;

        var pending = await _approvalService.WaitForApprovalAsync(ctx.RunId.ToString(), node.Id, prompt ?? "", TimeSpan.FromSeconds(timeoutSeconds));

        try
        {
            var approved = await pending.Task.WaitAsync(ct);
            if (!approved)
                return new NodeResult { Error = "用户拒绝审批", BranchHandle = "rejected" };
            return new NodeResult { Output = "已审批通过", BranchHandle = "approved" };
        }
        catch (OperationCanceledException)
        {
            return new NodeResult { Error = "审批等待被取消" };
        }
    }

    private static Dictionary<string, object>? ParseConfig(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return null;
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(configJson, JsonOptions); }
        catch { return null; }
    }
}
