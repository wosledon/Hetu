using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Work;
using Hetu.Shared.Work;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 查看当前分支的 PR / MR（只读）：状态、变更量、CI 检查、审查结论、合并门禁，
/// 或失败检查 + 审查意见 + 失败日志（view=feedback）。
/// </summary>
public class WorkPrTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkPrTool(WorkToolContext context) => _context = context;

    public string Name => "work_pr";
    public string Description => "查看当前分支的 PR / MR 状态：变更量、CI 检查、审查结论、合并门禁，以及失败检查与审查意见";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户提到 PR / MR、审查意见、CI 失败，或要汇报「能不能合并」时用它；创建、合并、关闭 PR 用 work_pr_action。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "view": { "type": "string", "enum": ["status", "feedback"], "description": "status=状态与检查概览（默认）；feedback=未通过的检查 + 审查意见 + 失败日志摘录" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        var runner = WorkPrCommandLine.ResolveRunner(_context);
        if (runner == null) return ToolExecutionResult.Error(WorkToolContext.NoProjectError);

        var view = "status";
        try
        {
            if (!string.IsNullOrWhiteSpace(argumentsJson))
            {
                var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
                if (args.ValueKind == JsonValueKind.Object
                    && args.TryGetProperty("view", out var node)
                    && node.ValueKind == JsonValueKind.String
                    && !string.IsNullOrWhiteSpace(node.GetString()))
                {
                    view = node.GetString()!;
                }
            }
        }
        catch (JsonException ex)
        {
            return ToolExecutionResult.Error($"参数解析失败：{ex.Message}");
        }

        var client = WorkPrClient.ForRunner(runner);
        var status = await client.GetStatusAsync(cancellationToken);
        var blocked = WorkPrCommandLine.Guard(status);
        if (blocked != null) return ToolExecutionResult.Error(blocked);

        if (view.Equals("feedback", StringComparison.OrdinalIgnoreCase))
        {
            var feedback = await client.GetFeedbackAsync(status, cancellationToken);
            if (!feedback.HasPr) return ToolExecutionResult.Success($"当前分支 {status.Branch} 还没有 PR。");
            return ToolExecutionResult.Success(WorkPrText.Feedback(status, feedback));
        }

        return ToolExecutionResult.Success(WorkPrText.Status(status));
    }
}

/// <summary>
/// 对当前分支的 PR 执行写操作：创建 / 合并 / 转草稿 / 标记可审查 / 关闭 / 重开。
/// 合并、关闭属于不可逆操作，走权限判定（默认 Ask）。
/// </summary>
public class WorkPrActionTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkPrActionTool(WorkToolContext context) => _context = context;

    public string Name => "work_pr_action";
    public string Description => "对当前分支的 PR / MR 执行写操作：create（创建）、merge（合并）、ready / draft（转正式 / 转草稿）、close / reopen";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;
    public string? UsageGuideline => "只在用户明确要求开 / 合并 / 关闭 PR 时调用；调用前先用 work_pr 确认门禁（检查与审查），并确保改动已提交并推送。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "action": { "type": "string", "enum": ["create", "merge", "ready", "draft", "close", "reopen"], "description": "要执行的操作" },
            "title": { "type": "string", "description": "action=create 时的 PR 标题（必填）" },
            "body": { "type": "string", "description": "action=create 时的 PR 描述（可选）" },
            "base_branch": { "type": "string", "description": "action=create 时的目标分支，留空用远端默认分支" },
            "draft": { "type": "boolean", "description": "action=create 时是否创建为草稿" },
            "merge_method": { "type": "string", "enum": ["merge", "squash", "rebase"], "description": "action=merge 时的合并方式，默认 merge" },
            "delete_branch": { "type": "boolean", "description": "action=merge 时是否在合并后删除源分支" }
        },
        "required": ["action"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        var runner = WorkPrCommandLine.ResolveRunner(_context);
        if (runner == null) return ToolExecutionResult.Error(WorkToolContext.NoProjectError);

        string action;
        string? title = null;
        string? body = null;
        string? baseBranch = null;
        var isDraft = false;
        string? mergeMethod = null;
        var deleteBranch = false;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return ToolExecutionResult.Error("参数必须是 JSON 对象");
            action = root.TryGetProperty("action", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() ?? string.Empty : string.Empty;
            if (string.IsNullOrWhiteSpace(action)) return ToolExecutionResult.Error("缺少必填参数 action");
            title = Text(root, "title");
            body = Text(root, "body");
            baseBranch = Text(root, "base_branch");
            mergeMethod = Text(root, "merge_method");
            isDraft = Flag(root, "draft");
            deleteBranch = Flag(root, "delete_branch");
        }
        catch (JsonException ex)
        {
            return ToolExecutionResult.Error($"参数解析失败：{ex.Message}");
        }

        var client = WorkPrClient.ForRunner(runner);
        var status = await client.GetStatusAsync(cancellationToken);
        var blocked = WorkPrCommandLine.Guard(status);
        if (blocked != null) return ToolExecutionResult.Error(blocked);

        if (action.Equals("create", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(title))
                return ToolExecutionResult.Error("action=create 需要提供 title");
            if (status.Pr != null)
                return ToolExecutionResult.Error($"当前分支 {status.Branch} 已有 PR #{status.Pr.Number}，不再重复创建");
            if (!status.BranchPushed)
                return ToolExecutionResult.Error($"分支 {status.Branch} 还没推送到远端：先提交并用 work_run_command 执行 git push -u origin {status.Branch}，再创建 PR");

            var created = await client.CreateAsync(
                new CreateWorkPrRequest { Title = title!, Body = body, BaseBranch = baseBranch, Draft = isDraft }, status, cancellationToken);
            if (!created.Success) return ToolExecutionResult.Error($"创建 PR 失败：{created.Output}");
            var createdStatus = created.Status ?? status;
            var url = createdStatus.Pr?.Url ?? created.Output;
            return ToolExecutionResult.Success($"✅ 已创建 PR：{url}\n\n{WorkPrText.Status(createdStatus)}");
        }

        if (status.Pr == null)
            return ToolExecutionResult.Error($"当前分支 {status.Branch} 没有 PR，无法执行 {action}");

        var result = await client.RunActionAsync(
            new WorkPrActionRequest { Action = action, MergeMethod = mergeMethod, DeleteBranch = deleteBranch }, status, cancellationToken);
        if (!result.Success) return ToolExecutionResult.Error($"{action} 失败：{result.Output}");

        var refreshed = result.Status ?? status;
        var merged = refreshed.Pr is { State: var state } && state.Equals("MERGED", StringComparison.OrdinalIgnoreCase);
        var head = merged ? $"✅ 已合并 PR #{refreshed.Pr!.Number}" : $"✅ 已执行 {action}";
        return ToolExecutionResult.Success($"{head}\n\n{WorkPrText.Status(refreshed)}");
    }

    private static string? Text(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()
            : null;

    private static bool Flag(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
}

/// <summary>PR 工具共用的上下文解析与守卫</summary>
internal static class WorkPrCommandLine
{
    /// <summary>项目执行器：优先用会话执行器（SSH / 工作树），退化成项目根目录的本地执行器</summary>
    public static IWorkCommandRunner? ResolveRunner(WorkToolContext context)
    {
        if (context.Runner != null) return context.Runner;
        return !string.IsNullOrWhiteSpace(context.ProjectRoot) && Directory.Exists(context.ProjectRoot)
            ? new LocalCommandRunner(context.ProjectRoot!)
            : null;
    }

    /// <summary>返回非 null 表示不能继续查询 / 操作</summary>
    public static string? Guard(WorkPrStatusDto status)
    {
        if (!status.IsRepo) return "当前目录不是 git 仓库";
        if (status.Message == "no-remote") return "仓库没有 origin 远端，无法查询或创建 PR";
        if (status.Message == "unsupported-host") return $"远端不是 GitHub / GitLab，暂不支持 PR：{status.RemoteUrl}";
        if (!status.ToolInstalled) return $"{status.Tool} 未安装：{status.InstallHint}";
        return null;
    }
}

/// <summary>PR 工具的输出排版：给模型读的紧凑文本</summary>
internal static class WorkPrText
{
    public static string Status(WorkPrStatusDto status)
    {
        var sb = new StringBuilder();
        var pr = status.Pr;
        sb.AppendLine($"分支 {status.Branch} → {status.BaseBranch}（{status.Tool}）");
        if (pr == null)
        {
            sb.AppendLine($"PR：无{(string.IsNullOrWhiteSpace(status.Message) ? string.Empty : $"（{status.Message}）")}");
        }
        else
        {
            sb.AppendLine($"PR：#{pr.Number} {pr.State.ToUpperInvariant()}{(pr.IsDraft ? "（草稿）" : string.Empty)} · {pr.Title}");
            sb.AppendLine($"变更：+{pr.Additions}/-{pr.Deletions}（{pr.ChangedFiles} 个文件）");
            sb.AppendLine($"门禁：{WorkPrClient.MergeStateLabel(pr.MergeStateStatus, pr.Mergeable)} · 审查：{WorkPrClient.ReviewLabel(pr.ReviewDecision)}");
            AppendChecks(sb, pr.Checks);
            if (!string.IsNullOrWhiteSpace(pr.Url)) sb.AppendLine($"链接：{pr.Url}");
        }

        if (status.OpenPrs.Count > 0)
        {
            sb.AppendLine("开放中的 PR：");
            foreach (var item in status.OpenPrs.Take(10))
                sb.AppendLine($"- #{item.Number} {item.Title}（{item.HeadBranch} → {item.BaseBranch}）");
        }
        return sb.ToString().TrimEnd();
    }

    public static string Feedback(WorkPrStatusDto status, WorkPrFeedbackDto feedback)
    {
        var sb = new StringBuilder();
        sb.AppendLine(Status(status));
        if (feedback.Checks.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("未通过的检查：");
            foreach (var check in feedback.Checks)
                sb.AppendLine($"- {check.Name}：{check.State}{(string.IsNullOrWhiteSpace(check.Link) ? string.Empty : $" · {check.Link}")}");
        }
        if (feedback.Comments.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("审查意见：");
            foreach (var comment in feedback.Comments)
            {
                var where = string.IsNullOrWhiteSpace(comment.Path) ? string.Empty : $" · {comment.Path}{(comment.Line == null ? string.Empty : $":{comment.Line}")}";
                sb.AppendLine($"- {comment.Author}{where}：{comment.Body}");
            }
        }
        if (!string.IsNullOrWhiteSpace(feedback.LogExcerpt))
        {
            sb.AppendLine();
            sb.AppendLine("失败日志摘录：");
            sb.AppendLine(feedback.LogExcerpt);
        }
        if (feedback.Checks.Count == 0 && feedback.Comments.Count == 0 && string.IsNullOrWhiteSpace(feedback.LogExcerpt))
        {
            sb.AppendLine();
            sb.AppendLine("没有失败检查、审查意见或失败日志：门禁已通过或该平台未回传明细。");
        }
        return sb.ToString().TrimEnd();
    }

    private static void AppendChecks(StringBuilder sb, List<WorkPrCheckDto> checks)
    {
        if (checks.Count == 0)
        {
            sb.AppendLine("CI 检查：无（该分支没有检查项，或托管平台未配置流水线）");
            return;
        }
        var passed = checks.Count(c => c.Bucket == "pass");
        var failed = checks.Count(c => c.Bucket == "fail");
        var pending = checks.Count(c => c.Bucket == "pending");
        sb.AppendLine($"CI 检查：共 {checks.Count} 项，通过 {passed} · 失败 {failed} · 进行中 {pending}");
        foreach (var check in checks.Where(c => c.Bucket != "pass").Take(10))
            sb.AppendLine($"- [{check.Bucket}] {check.Name}：{check.State}{(string.IsNullOrWhiteSpace(check.Link) ? string.Empty : $" · {check.Link}")}");
    }
}
