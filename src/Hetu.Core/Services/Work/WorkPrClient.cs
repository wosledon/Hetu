using System.Text.Json;
using System.Text.RegularExpressions;
using Hetu.Shared.Work;

namespace Hetu.Core.Services.Work;

/// <summary>在项目（或会话工作树）目录里执行一条命令，返回退出码与输出。</summary>
public delegate Task<WorkCommandResult> WorkPrCommandRunner(string command, string? stdin, TimeSpan? timeout, CancellationToken ct);

/// <summary>
/// PR / MR 的 gh（GitHub）/ glab（GitLab）调用与解析。
/// Code 面板的 HTTP 接口（<c>WorkGitService</c>）与 Agent 的 work_pr / work_pr_action 工具共用这一份实现，
/// 避免字段列表、命令行参数与 JSON 解析各写一套。自身只依赖注入进来的命令执行器，不碰 DI 与数据库。
/// </summary>
public class WorkPrClient
{
    /// <summary>gh / glab 这类网络命令的超时</summary>
    private static readonly TimeSpan NetworkTimeout = TimeSpan.FromMinutes(2);

    /// <summary>本地 git 查询的超时</summary>
    private static readonly TimeSpan LocalGitTimeout = TimeSpan.FromSeconds(30);

    /// <summary>失败日志摘录上限：交给模型的内容不宜过长</summary>
    private const int LogExcerptLimit = 12000;

    /// <summary>最多抓取几条失败检查的日志</summary>
    private const int FailedRunLimit = 2;

    /// <summary>gh pr view 要回传的字段（状态 + 合并门禁 + 变更量）</summary>
    public const string GitHubFields =
        "number,title,url,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles";

    private readonly WorkPrCommandRunner _run;

    public WorkPrClient(WorkPrCommandRunner run) => _run = run;

    /// <summary>用项目执行器构造（本地直跑 / SSH 远端），统一超时与「超时不抛异常」的语义</summary>
    public static WorkPrClient ForRunner(IWorkCommandRunner runner) => new(async (command, stdin, timeout, ct) =>
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout ?? NetworkTimeout);
        try
        {
            return await runner.RunAsync(command, stdin, cts.Token, timeout);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new WorkCommandResult(-1, "命令超时（网络较慢时请在终端里手动执行）", string.Empty);
        }
    });

    private async Task<(int ExitCode, string Output)> GitAsync(string arguments, CancellationToken cancellationToken = default)
    {
        var result = await _run($"git {arguments}", null, LocalGitTimeout, cancellationToken);
        return (result.ExitCode, result.Combined);
    }

    private async Task<(int ExitCode, string Output)> ToolAsync(string command, string? stdin = null, CancellationToken cancellationToken = default)
    {
        var result = await _run(command, stdin, NetworkTimeout, cancellationToken);
        return (result.ExitCode, result.Combined);
    }

    /// <summary>
    /// PR / MR 状态：从远端地址判断托管平台（GitHub → gh，GitLab → glab），
    /// CLI 未安装时回传安装命令引导用户安装，已安装时查当前分支的 PR 与开放 PR 列表。
    /// </summary>
    public async Task<WorkPrStatusDto> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var status = new WorkPrStatusDto();

        var (branchCode, branchOutput) = await GitAsync("rev-parse --abbrev-ref HEAD", cancellationToken);
        if (branchCode != 0) return status; // 非 git 仓库
        status.IsRepo = true;
        status.Branch = branchOutput.Trim();

        var (remoteCode, remoteOutput) = await GitAsync("remote get-url origin", cancellationToken);
        if (remoteCode != 0 || string.IsNullOrWhiteSpace(remoteOutput))
        {
            status.Message = "no-remote";
            return status;
        }
        status.RemoteUrl = remoteOutput.Trim();

        var host = ParseRemoteHost(status.RemoteUrl);
        var isGitLab = host != null && host.Contains("gitlab", StringComparison.OrdinalIgnoreCase);
        var isGitHub = host != null && host.Contains("github", StringComparison.OrdinalIgnoreCase);
        if (!isGitLab && !isGitHub)
        {
            status.Message = "unsupported-host";
            return status;
        }
        status.Host = isGitLab ? "gitlab" : "github";
        status.Tool = isGitLab ? "glab" : "gh";
        status.InstallUrl = isGitLab ? "https://gitlab.com/gitlab-org/cli" : "https://cli.github.com";

        var (toolCode, _) = await ToolAsync($"{status.Tool} --version", cancellationToken: cancellationToken);
        status.ToolInstalled = toolCode == 0;
        if (!status.ToolInstalled)
        {
            status.InstallHint = InstallHint(status.Tool!);
            return status;
        }

        // 默认目标分支：origin/HEAD → origin/main|master → 当前分支
        var target = await ResolveIntegrationRefAsync(cancellationToken);
        status.BaseBranch = string.IsNullOrWhiteSpace(target) ? status.Branch : target;

        // 分支是否已推送到远端（没推送时远端还没有这个分支，也就谈不上 PR）
        var (upstreamCode, upstreamOut) = await GitAsync($"config --get branch.{status.Branch}.remote", cancellationToken);
        status.BranchPushed = upstreamCode == 0 && !string.IsNullOrWhiteSpace(upstreamOut);

        var viewArgs = isGitLab ? "mr view --output json" : $"pr view --json {GitHubFields}";
        var (viewCode, viewOutput) = await ToolAsync($"{status.Tool} {viewArgs}", cancellationToken: cancellationToken);
        if (viewCode != 0)
        {
            status.Message = FirstLine(viewOutput);
        }
        else
        {
            status.Pr = ParsePr(status.Host!, viewOutput);
            // CI 明细单独查：gh pr view 的 statusCheckRollup 结构与 gh pr checks 不同，后者能直接给出归并桶
            if (status.Pr != null && !isGitLab) await FillChecksAsync(status.Tool!, status.Pr, cancellationToken);
        }

        // 开放中的 PR / MR：让「当前 PR」有对照，查不到也不影响主流程
        var listArgs = isGitLab
            ? "mr list --opened --output json"
            : "pr list --state open --limit 10 --json number,title,url,state,isDraft,baseRefName,headRefName";
        var (listCode, listOutput) = await ToolAsync($"{status.Tool} {listArgs}", cancellationToken: cancellationToken);
        if (listCode == 0) status.OpenPrs = ParsePrList(status.Host!, listOutput);
        return status;
    }

    /// <summary>
    /// 一行 PR 摘要，供会话 system prompt 注入（让 Agent 感知门禁与审查状态）。
    /// 不是 git 仓库 / 远端不支持 / CLI 不可用时返回 null，不打扰主流程。
    /// </summary>
    public async Task<string?> GetSummaryAsync(CancellationToken cancellationToken = default)
    {
        var (branchCode, branchOutput) = await GitAsync("rev-parse --abbrev-ref HEAD", cancellationToken);
        if (branchCode != 0) return null;
        var branch = branchOutput.Trim();

        var (remoteCode, remoteOutput) = await GitAsync("remote get-url origin", cancellationToken);
        if (remoteCode != 0 || string.IsNullOrWhiteSpace(remoteOutput)) return null;

        var host = ParseRemoteHost(remoteOutput.Trim());
        var isGitLab = host != null && host.Contains("gitlab", StringComparison.OrdinalIgnoreCase);
        var isGitHub = host != null && host.Contains("github", StringComparison.OrdinalIgnoreCase);
        if (!isGitLab && !isGitHub) return null;

        var tool = isGitLab ? "glab" : "gh";
        var viewArgs = isGitLab ? "mr view --output json" : $"pr view --json {GitHubFields}";
        var (code, output) = await ToolAsync($"{tool} {viewArgs}", cancellationToken: cancellationToken);
        if (code != 0)
        {
            // 只有「明确没有 PR」才注入结论；未登录 / CLI 缺失等错误不写进提示词
            var noPr = output.Contains("no pull requests found", StringComparison.OrdinalIgnoreCase)
                || output.Contains("no merge requests", StringComparison.OrdinalIgnoreCase);
            return noPr ? $"PR：当前分支 {branch} 还没有 PR（可用 work_pr_action 创建）" : null;
        }

        var pr = ParsePr(isGitLab ? "gitlab" : "github", output);
        if (pr == null) return null;

        var gate = MergeStateLabel(pr.MergeStateStatus, pr.Mergeable);
        var review = ReviewLabel(pr.ReviewDecision);
        var first = $"PR：#{pr.Number} {pr.State.ToUpperInvariant()}{(pr.IsDraft ? "（草稿）" : string.Empty)} · {pr.Title}";
        var second = $"变更 +{pr.Additions}/-{pr.Deletions}（{pr.ChangedFiles} 个文件）· 门禁 {gate} · 审查 {review}" +
                     (string.IsNullOrWhiteSpace(pr.Url) ? string.Empty : $" · {pr.Url}");
        return $"{first}\n{second}";
    }

    /// <summary>创建 PR / MR（目标分支留空用远端默认分支），成功后回传刷新后的状态</summary>
    public async Task<WorkPrCommandResultDto> CreateAsync(
        CreateWorkPrRequest request, WorkPrStatusDto? known = null, CancellationToken cancellationToken = default)
    {
        var status = known ?? await GetStatusAsync(cancellationToken);
        var isGitLab = status.Tool == "gitlab";
        var baseBranch = string.IsNullOrWhiteSpace(request.BaseBranch) ? status.BaseBranch : request.BaseBranch!.Trim();
        var args = isGitLab
            ? $"mr create --title {Quote(request.Title)} --target-branch {Quote(baseBranch ?? string.Empty)} --description {Quote(request.Body ?? string.Empty)} --yes"
                + (request.Draft ? " --draft" : string.Empty)
            : $"pr create --title {Quote(request.Title)} --base {Quote(baseBranch ?? string.Empty)} --body-file -"
                + (request.Draft ? " --draft" : string.Empty);

        var (code, output) = await ToolAsync($"{status.Tool} {args}", status.Tool == "gh" ? request.Body ?? string.Empty : null, cancellationToken);
        var refreshed = await GetStatusAsync(cancellationToken);
        return new WorkPrCommandResultDto { Success = code == 0, Output = output.Trim(), Status = refreshed };
    }

    /// <summary>PR 操作：转正式 / 转草稿 / 合并 / 关闭 / 重开（作用于当前分支的 PR），成功后回传刷新后的状态</summary>
    public async Task<WorkPrCommandResultDto> RunActionAsync(
        WorkPrActionRequest request, WorkPrStatusDto? known = null, CancellationToken cancellationToken = default)
    {
        var status = known ?? await GetStatusAsync(cancellationToken);
        var action = (request.Action ?? string.Empty).Trim().ToLowerInvariant();
        var args = BuildActionArgs(status.Tool ?? string.Empty, action, request);
        if (args == null)
            return new WorkPrCommandResultDto { Success = false, Output = $"不支持的 PR 操作：{request.Action}", Status = status };

        var (code, output) = await ToolAsync($"{status.Tool} {args}", cancellationToken: cancellationToken);
        var refreshed = await GetStatusAsync(cancellationToken);
        return new WorkPrCommandResultDto { Success = code == 0, Output = output.Trim(), Status = refreshed };
    }

    /// <summary>
    /// 待处理反馈：失败 / 进行中的 CI 检查 + 审查意见 + 失败日志摘录。
    /// 全只读；抓不到的部分留空，不影响调用方展示。
    /// </summary>
    public async Task<WorkPrFeedbackDto> GetFeedbackAsync(WorkPrStatusDto? known = null, CancellationToken cancellationToken = default)
    {
        var status = known ?? await GetStatusAsync(cancellationToken);
        var feedback = new WorkPrFeedbackDto();
        var pr = status.Pr;
        if (pr == null)
        {
            feedback.Message = status.Message;
            return feedback;
        }

        feedback.HasPr = true;
        feedback.Number = pr.Number;
        feedback.Title = pr.Title;
        feedback.Url = pr.Url;
        feedback.Mergeable = pr.Mergeable;
        feedback.MergeStateStatus = pr.MergeStateStatus;
        feedback.ReviewDecision = pr.ReviewDecision;
        feedback.Additions = pr.Additions;
        feedback.Deletions = pr.Deletions;
        feedback.ChangedFiles = pr.ChangedFiles;
        feedback.Checks = pr.Checks.Where(c => c.Bucket is "fail" or "pending" or "cancel").ToList();

        // 评论与运行日志目前只抓 GitHub：GitLab 侧仍可把流水线明细交给模型
        if (status.Host != "github") return feedback;
        var slug = ParseRepoSlug(status.RemoteUrl);
        if (slug == null) return feedback;

        feedback.Comments.AddRange(await FetchCommentsAsync(slug, pr.Number, cancellationToken));
        feedback.LogExcerpt = await FetchFailureLogsAsync(pr.Checks, cancellationToken);
        return feedback;
    }

    /// <summary>把动作翻译成 gh / glab 的命令行参数；未知动作返回 null</summary>
    private static string? BuildActionArgs(string tool, string action, WorkPrActionRequest request)
    {
        var isGitLab = tool == "glab";
        return action switch
        {
            "ready" => isGitLab ? "mr update --ready" : "pr ready",
            "draft" => isGitLab ? "mr update --draft" : "pr ready --undo",
            "merge" => MergeArgs(isGitLab, request),
            "close" => isGitLab ? "mr close" : "pr close",
            "reopen" => isGitLab ? "mr reopen" : "pr reopen",
            _ => null,
        };
    }

    /// <summary>合并参数：gh 用 --merge/--squash/--rebase，glab 只区分 squash / rebase</summary>
    private static string MergeArgs(bool isGitLab, WorkPrActionRequest request)
    {
        var method = (request.MergeMethod ?? string.Empty).Trim().ToLowerInvariant();
        if (isGitLab)
        {
            var flag = method switch { "squash" => " --squash", "rebase" => " --rebase", _ => string.Empty };
            return "mr merge --yes" + flag + (request.DeleteBranch ? " --remove-source-branch" : string.Empty);
        }
        var ghMethod = method is "squash" or "rebase" ? method : "merge";
        return $"pr merge --{ghMethod}" + (request.DeleteBranch ? " --delete-branch" : string.Empty);
    }

    /// <summary>补上 CI 明细。没有检查项时 gh 会以非 0 退出并只打一行提示，这里忽略退出码只看能否解析出 JSON。</summary>
    private async Task FillChecksAsync(string tool, WorkPrInfoDto pr, CancellationToken cancellationToken)
    {
        var (_, output) = await ToolAsync($"{tool} pr checks --json name,state,bucket,link,workflow", cancellationToken: cancellationToken);
        var checks = ParseChecks(output);
        if (checks.Count > 0) pr.Checks = checks;
    }

    /// <summary>抓取行内审查意见与审查结论（普通评论对「修改代码」帮助有限，先不取）</summary>
    private async Task<List<WorkPrCommentDto>> FetchCommentsAsync(string repoSlug, int number, CancellationToken cancellationToken)
    {
        const int maxComments = 30;
        const int maxBodyLength = 2000;
        var comments = new List<WorkPrCommentDto>();

        var (reviewCode, reviewOutput) = await ToolAsync($"api repos/{repoSlug}/pulls/{number}/comments?per_page=100", cancellationToken: cancellationToken);
        if (reviewCode == 0) comments.AddRange(ParseComments(reviewOutput, "review", maxBodyLength));

        var (summaryCode, summaryOutput) = await ToolAsync($"api repos/{repoSlug}/pulls/{number}/reviews?per_page=100", cancellationToken: cancellationToken);
        if (summaryCode == 0) comments.AddRange(ParseComments(summaryOutput, "review-summary", maxBodyLength));

        return comments
            .OrderBy(c => c.CreatedAt ?? string.Empty, StringComparer.Ordinal)
            .Take(maxComments)
            .ToList();
    }

    /// <summary>按失败检查的运行链接取 --log-failed 摘录（最多两条，超出截断）</summary>
    private async Task<string?> FetchFailureLogsAsync(List<WorkPrCheckDto> checks, CancellationToken cancellationToken)
    {
        var runIds = new List<string>();
        foreach (var check in checks)
        {
            if (check.Bucket != "fail" || string.IsNullOrWhiteSpace(check.Link)) continue;
            var match = Regex.Match(check.Link!, @"/runs/(\d+)");
            if (!match.Success) continue;
            var id = match.Groups[1].Value;
            if (!runIds.Contains(id)) runIds.Add(id);
            if (runIds.Count >= FailedRunLimit) break;
        }
        if (runIds.Count == 0) return null;

        var buffer = new System.Text.StringBuilder();
        foreach (var id in runIds)
        {
            var (code, output) = await ToolAsync($"run view {id} --log-failed", cancellationToken: cancellationToken);
            if (code != 0 || string.IsNullOrWhiteSpace(output)) continue;
            buffer.AppendLine(output.Trim());
            if (buffer.Length >= LogExcerptLimit) break;
        }
        var text = buffer.ToString().Trim();
        if (text.Length == 0) return null;
        return text.Length > LogExcerptLimit ? text[..LogExcerptLimit] + "…" : text;
    }

    /// <summary>集成分支（origin/HEAD → origin/main|master），拿不到返回 null</summary>
    private async Task<string?> ResolveIntegrationRefAsync(CancellationToken cancellationToken)
    {
        var (headCode, head) = await GitAsync("symbolic-ref --short refs/remotes/origin/HEAD", cancellationToken);
        if (headCode == 0 && !string.IsNullOrWhiteSpace(head)) return StripRemote(head.Trim());

        foreach (var candidate in new[] { "origin/main", "origin/master" })
        {
            var (code, _) = await GitAsync($"rev-parse --verify --quiet {candidate}", cancellationToken);
            if (code == 0) return StripRemote(candidate);
        }
        return null;
    }

    /// <summary>remote/分支 → 分支名</summary>
    private static string StripRemote(string reference)
    {
        var slash = reference.IndexOf('/');
        return slash >= 0 ? reference[(slash + 1)..] : reference;
    }

    private static string? FirstLine(string? output)
        => string.IsNullOrWhiteSpace(output)
            ? null
            : output.Trim().Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();

    /// <summary>为本机 shell（PowerShell / bash）转义参数</summary>
    public static string Quote(string value)
        => OperatingSystem.IsWindows()
            ? $"'{value.Replace("'", "''")}'"
            : $"'{value.Replace("'", "'\\''")}'";

    /// <summary>远端地址解析出主机名（支持 https://host/... 与 git@host:owner/repo.git）</summary>
    public static string? ParseRemoteHost(string remoteUrl)
    {
        var url = remoteUrl.Trim();
        var at = url.IndexOf('@');
        if (at >= 0)
        {
            var rest = url[(at + 1)..];
            var colon = rest.IndexOf(':');
            var slash = rest.IndexOf('/');
            var end = colon >= 0 && (slash < 0 || colon < slash) ? colon : slash;
            if (end > 0) return rest[..end];
        }
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : null;
    }

    /// <summary>远端地址解析出 owner/repo（GitHub 接口路径需要）</summary>
    public static string? ParseRepoSlug(string? remoteUrl)
    {
        if (string.IsNullOrWhiteSpace(remoteUrl)) return null;
        var path = remoteUrl.Trim();
        if (path.EndsWith(".git", StringComparison.OrdinalIgnoreCase)) path = path[..^4];
        var scheme = path.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0) path = path[(scheme + 3)..];
        // git@host:owner/repo → 冒号后才是路径；https://host/owner/repo 只剩 host/owner/repo
        var colon = path.IndexOf(':');
        var slash = path.IndexOf('/');
        if (colon >= 0 && (slash < 0 || colon < slash)) path = path[(colon + 1)..];
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length switch
        {
            >= 3 => $"{segments[1]}/{segments[2]}",
            2 => $"{segments[0]}/{segments[1]}",
            _ => null,
        };
    }

    /// <summary>当前系统的 CLI 安装命令（引导用户安装）</summary>
    public static string InstallHint(string tool)
    {
        if (OperatingSystem.IsWindows()) return tool == "gh" ? "winget install --id GitHub.cli" : "scoop install glab";
        if (OperatingSystem.IsMacOS()) return $"brew install {tool}";
        return $"sudo apt install {tool}";
    }

    /// <summary>合并门禁的可读标签（注入 prompt / 工具输出用）</summary>
    public static string MergeStateLabel(string? mergeStateStatus, string? mergeable)
    {
        if (string.Equals(mergeable, "CONFLICTING", StringComparison.OrdinalIgnoreCase)) return "有冲突";
        return (mergeStateStatus ?? string.Empty).ToUpperInvariant() switch
        {
            "CLEAN" => "可合并",
            "DIRTY" => "有冲突",
            "BLOCKED" => "被阻塞",
            "BEHIND" => "落后源分支",
            "UNSTABLE" => "检查未全绿",
            "HAS_HOOKS" => "待钩子检查",
            _ => "未知",
        };
    }

    /// <summary>审查结论的可读标签</summary>
    public static string ReviewLabel(string? decision)
        => (decision ?? string.Empty).ToUpperInvariant() switch
        {
            "APPROVED" => "已通过审查",
            "CHANGES_REQUESTED" => "要求修改",
            "REVIEW_REQUIRED" => "需要审查",
            _ => "待审查",
        };

    /// <summary>解析 gh / glab 的 JSON 数组输出（开放中的 PR 列表）</summary>
    public static List<WorkPrInfoDto> ParsePrList(string host, string json)
    {
        var list = new List<WorkPrInfoDto>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var pr = ParsePrElement(host, item);
                if (pr != null && pr.Number > 0) list.Add(pr);
            }
        }
        catch (JsonException)
        {
            // 列表解析失败就当没有，不影响主流程
        }
        return list;
    }

    /// <summary>解析 gh / glab 的 JSON 输出</summary>
    public static WorkPrInfoDto? ParsePr(string host, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return ParsePrElement(host, doc.RootElement);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static WorkPrInfoDto? ParsePrElement(string host, JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        string? text(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        bool flag(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
        int number(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetInt32() : 0;
        if (host == "gitlab")
        {
            return new WorkPrInfoDto
            {
                Number = number("iid"),
                Title = text("title") ?? string.Empty,
                Url = text("web_url") ?? string.Empty,
                State = text("state") ?? string.Empty,
                IsDraft = flag("draft") || flag("work_in_progress"),
                BaseBranch = text("target_branch"),
                HeadBranch = text("source_branch"),
                Mergeable = text("merge_status"),
                MergeStateStatus = text("detailed_merge_status") ?? text("merge_status"),
                ReviewDecision = flag("approved") ? "APPROVED" : null,
                Checks = ParseGitLabPipeline(root),
            };
        }
        return new WorkPrInfoDto
        {
            Number = number("number"),
            Title = text("title") ?? string.Empty,
            Url = text("url") ?? string.Empty,
            State = text("state") ?? string.Empty,
            IsDraft = flag("isDraft"),
            BaseBranch = text("baseRefName"),
            HeadBranch = text("headRefName"),
            Mergeable = text("mergeable"),
            MergeStateStatus = text("mergeStateStatus"),
            // gh 在没有审查结论时回传空字符串，统一成 null 让调用方只判空
            ReviewDecision = string.IsNullOrWhiteSpace(text("reviewDecision")) ? null : text("reviewDecision"),
            Additions = number("additions"),
            Deletions = number("deletions"),
            ChangedFiles = number("changedFiles"),
        };
    }

    /// <summary>GitLab MR 的流水线映射成一条检查：调用方无需区分平台</summary>
    private static List<WorkPrCheckDto> ParseGitLabPipeline(JsonElement root)
    {
        var list = new List<WorkPrCheckDto>();
        if (!root.TryGetProperty("head_pipeline", out var pipeline) || pipeline.ValueKind != JsonValueKind.Object) return list;
        string? text(string name) => pipeline.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        var state = text("status");
        if (string.IsNullOrWhiteSpace(state)) return list;
        list.Add(new WorkPrCheckDto
        {
            Name = "pipeline",
            State = state!,
            Bucket = state switch
            {
                "success" => "pass",
                "failed" => "fail",
                "canceled" => "cancel",
                "skipped" => "skipping",
                _ => "pending",
            },
            Link = text("web_url"),
        });
        return list;
    }

    /// <summary>解析 gh pr checks 的 JSON 数组</summary>
    public static List<WorkPrCheckDto> ParseChecks(string json)
    {
        const int maxChecks = 40;
        var list = new List<WorkPrCheckDto>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                string? text(string name) => item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
                var name = text("name") ?? text("workflow");
                if (string.IsNullOrWhiteSpace(name)) continue;
                list.Add(new WorkPrCheckDto
                {
                    Name = name!,
                    Workflow = text("workflow"),
                    State = text("state") ?? string.Empty,
                    Bucket = text("bucket") ?? string.Empty,
                    Link = text("link"),
                });
                if (list.Count >= maxChecks) break;
            }
        }
        catch (JsonException)
        {
            // 解析失败当作没有检查项
        }
        return list;
    }

    /// <summary>解析 gh api 的评论 / 审查 JSON 数组；没有正文的记录跳过</summary>
    public static List<WorkPrCommentDto> ParseComments(string json, string kind, int maxBodyLength = 2000)
    {
        var list = new List<WorkPrCommentDto>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                var body = Text(item, "body");
                if (string.IsNullOrWhiteSpace(body)) continue;
                var author = item.TryGetProperty("user", out var user) && user.ValueKind == JsonValueKind.Object ? Text(user, "login") : null;
                list.Add(new WorkPrCommentDto
                {
                    Author = author ?? string.Empty,
                    Body = body!.Length > maxBodyLength ? body[..maxBodyLength] + "…" : body,
                    Path = Text(item, "path"),
                    Line = Number(item, "line") ?? Number(item, "original_line"),
                    Kind = kind,
                    CreatedAt = Text(item, "created_at") ?? Text(item, "submitted_at"),
                });
            }
        }
        catch (JsonException)
        {
            // 解析失败当作没有意见
        }
        return list;
    }

    private static string? Text(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? Number(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetInt32() : null;
}
