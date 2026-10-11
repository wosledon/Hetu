using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Work;
using Hetu.Shared.Work;

namespace Hetu.Api.Services;

/// <summary>
/// 工作区 Git 面板后端：对项目根目录执行只读 git 查询（分支/状态/内容对比），
/// 以及显式提交（git add 指定路径 + commit）。本地项目直接执行；SSH 项目通过 ssh 客户端执行。
/// </summary>
public class WorkGitService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly Func<Hetu.Core.Entities.WorkProject, IWorkCommandRunner> _runnerFactory;

    public WorkGitService(IServiceScopeFactory scopeFactory, Func<Hetu.Core.Entities.WorkProject, IWorkCommandRunner>? runnerFactory = null)
    {
        _scopeFactory = scopeFactory;
        _runnerFactory = runnerFactory ?? (p => p.ConnectionType == "Ssh"
            ? new SshCommandRunner(p, _ => null)
            : new LocalCommandRunner(p.RootPath));
    }

    /// <summary>解析项目命令执行器；项目不存在时返回 null。<paramref name="sessionId"/> 命中独立工作树时改用工作树目录。</summary>
    private async Task<IWorkCommandRunner?> ResolveRunnerAsync(Guid projectId, CancellationToken cancellationToken)
        => await ResolveRunnerAsync(projectId, null, cancellationToken);

    private async Task<IWorkCommandRunner?> ResolveRunnerAsync(Guid projectId, Guid? sessionId, CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
        var project = await unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null || string.IsNullOrWhiteSpace(project.RootPath)) return null;
        if (project.ConnectionType == "Ssh" && string.IsNullOrWhiteSpace(project.SshHost)) return null;
        if (project.ConnectionType != "Ssh" && !Directory.Exists(project.RootPath)) return null;

        if (sessionId is Guid sid && project.ConnectionType != "Ssh")
        {
            var session = await unitOfWork.WorkSessions.GetByIdAsync(sid, cancellationToken);
            if (session?.ProjectId == projectId
                && !string.IsNullOrWhiteSpace(session.WorktreePath)
                && Directory.Exists(session.WorktreePath))
            {
                return new LocalCommandRunner(session.WorktreePath);
            }
        }

        return _runnerFactory(project);
    }

    private static async Task<(int ExitCode, string Output)> RunGitAsync(
        IWorkCommandRunner runner, string arguments, string? stdin = null,
        CancellationToken cancellationToken = default, TimeSpan? timeout = null)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeout ?? TimeSpan.FromSeconds(30));
        try
        {
            var result = await runner.RunAsync($"git {arguments}", stdin, cts.Token, timeout);
            return (result.ExitCode, result.Combined);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (-1, "命令超时（网络较慢时请在终端里手动执行）");
        }
    }

    private static string NormalizeRelativePath(string root, string path)
    {
        var full = Path.GetFullPath(Path.Combine(root, path));
        if (!full.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("路径越界");
        return Path.GetRelativePath(root, full).Replace('\\', '/');
    }

    /// <summary>项目分支列表 + 当前分支（Code 会话的分支/工作树选择器用）</summary>
    public async Task<WorkBranchListDto> GetBranchesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var dto = new WorkBranchListDto();
        var runner = await ResolveRunnerAsync(projectId, cancellationToken);
        if (runner == null)
        {
            dto.WorktreeUnsupportedReason = "project-unavailable";
            return dto;
        }
        if (runner.IsRemote)
            dto.WorktreeUnsupportedReason = "remote";

        var (code, current) = await RunGitAsync(runner, "rev-parse --abbrev-ref HEAD", cancellationToken: cancellationToken);
        if (code != 0) return dto; // 非 git 仓库 / git 不可用

        dto.IsRepo = true;
        dto.Current = current.Trim();
        // rev-parse 而非 for-each-ref --format=%(...)：本地命令经 PowerShell / bash 执行，%() 会被 PowerShell 解析
        var (_, refs) = await RunGitAsync(runner, "rev-parse --symbolic --branches", cancellationToken: cancellationToken);
        dto.Branches = SplitRefs(refs);
        // 远程分支（origin/main 等）：选它时按同名建本地跟踪分支；symbolic refs（origin/HEAD）不算
        var (remoteCode, remoteRefs) = await RunGitAsync(runner, "rev-parse --symbolic --remotes", cancellationToken: cancellationToken);
        if (remoteCode == 0)
        {
            dto.RemoteBranches = SplitRefs(remoteRefs)
                .Where(name => !name.EndsWith("/HEAD", StringComparison.OrdinalIgnoreCase))
                .ToList();
        }
        return dto;
    }

    /// <summary>把 rev-parse 输出的多行引用整理成去重排序的列表</summary>
    private static List<string> SplitRefs(string output)
        => output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(line => line, StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>
    /// 在项目里挂一个独立工作树（仅本地项目）。分支已存在于本地时直接检出该分支，
    /// 需要新建（<paramref name="createBranch"/>）时按 <paramref name="baseBranch"/> 派生。
    /// </summary>

    public async Task<WorkGitStatusDto> GetStatusAsync(Guid projectId, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var status = new WorkGitStatusDto();
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return status;

        var (branchCode, branchOutput) = await RunGitAsync(runner, "rev-parse --abbrev-ref HEAD", cancellationToken: cancellationToken);
        if (branchCode != 0) return status; // 非 git 仓库或 git 不可用
        status.IsRepo = true;
        status.Branch = branchOutput.Trim();

        var (_, porcelain) = await RunGitAsync(runner, "status --porcelain", cancellationToken: cancellationToken);
        foreach (var line in porcelain.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = line.TrimEnd('\r');
            if (trimmed.Length < 4) continue;
            var code = trimmed[..2].Trim();
            var path = trimmed[3..].Trim();
            // 重命名 "old -> new" 取新路径
            var arrow = path.IndexOf(" -> ", StringComparison.Ordinal);
            if (arrow >= 0) path = path[(arrow + 4)..];
            status.Files.Add(new WorkGitFileStatusDto { Path = path, Status = code.Length == 0 ? "??" : code });
        }

        // 上游与领先/落后：porcelain=v2 的 branch.* 头信息（不用 @{u}，避免 PowerShell 把 @{} 当哈希表解析）
        var (_, v2) = await RunGitAsync(runner, "status --porcelain=v2 --branch", cancellationToken: cancellationToken);
        foreach (var line in v2.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = line.TrimEnd('\r');
            if (trimmed.StartsWith("# branch.upstream ", StringComparison.Ordinal))
            {
                status.Upstream = trimmed["# branch.upstream ".Length..].Trim();
            }
            else if (trimmed.StartsWith("# branch.ab ", StringComparison.Ordinal))
            {
                var parts = trimmed["# branch.ab ".Length..].Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 2 && parts[0].StartsWith('+') && parts[1].StartsWith('-'))
                {
                    if (int.TryParse(parts[0][1..], out var ahead)) status.Ahead = ahead;
                    if (int.TryParse(parts[1][1..], out var behind)) status.Behind = behind;
                }
            }
        }
        return status;
    }

    /// <summary>拉取：只允许快进（--ff-only），避免在用户仓库里自动产生合并提交</summary>
    public async Task<WorkGitCommandResultDto> PullAsync(Guid projectId, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return new WorkGitCommandResultDto { Success = false, Output = "项目不存在" };

        var (code, output) = await RunGitAsync(runner, "pull --ff-only", cancellationToken: cancellationToken, timeout: TimeSpan.FromMinutes(3));
        return new WorkGitCommandResultDto { Success = code == 0, Output = output.Trim() };
    }

    /// <summary>推送：没有上游时按当前分支设置上游（push -u origin &lt;branch&gt;）</summary>
    public async Task<WorkGitCommandResultDto> PushAsync(Guid projectId, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return new WorkGitCommandResultDto { Success = false, Output = "项目不存在" };

        var (branchCode, branchOutput) = await RunGitAsync(runner, "rev-parse --abbrev-ref HEAD", cancellationToken: cancellationToken);
        if (branchCode != 0) return new WorkGitCommandResultDto { Success = false, Output = "当前目录不是 git 仓库" };
        var branch = branchOutput.Trim();

        var (remoteCode, remoteOutput) = await RunGitAsync(runner, $"config --get branch.{branch}.remote", cancellationToken: cancellationToken);
        var hasUpstream = remoteCode == 0 && !string.IsNullOrWhiteSpace(remoteOutput);

        var arguments = hasUpstream ? "push" : $"push -u origin {branch}";
        var (code, output) = await RunGitAsync(runner, arguments, cancellationToken: cancellationToken, timeout: TimeSpan.FromMinutes(3));
        return new WorkGitCommandResultDto { Success = code == 0, Output = output.Trim() };
    }

    /// <summary>
    /// PR / MR 状态：从远端地址判断托管平台（GitHub → gh，GitLab → glab），
    /// CLI 未安装时回传安装命令引导用户安装，已安装时查当前分支的 PR。
    /// </summary>
    public async Task<WorkPrStatusDto> GetPrStatusAsync(Guid projectId, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var status = new WorkPrStatusDto();
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return status;

        var (branchCode, branchOutput) = await RunGitAsync(runner, "rev-parse --abbrev-ref HEAD", cancellationToken: cancellationToken);
        if (branchCode != 0) return status; // 非 git 仓库
        status.IsRepo = true;
        status.Branch = branchOutput.Trim();

        var (remoteCode, remoteOutput) = await RunGitAsync(runner, "remote get-url origin", cancellationToken: cancellationToken);
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

        var (toolCode, _) = await RunToolAsync(runner, $"{status.Tool} --version", cancellationToken: cancellationToken);
        status.ToolInstalled = toolCode == 0;
        if (!status.ToolInstalled)
        {
            status.InstallHint = InstallHint(status.Tool!);
            return status;
        }

        // 默认目标分支：origin/HEAD → origin/main|master → 当前分支
        var target = await ResolveIntegrationRefAsync(runner, cancellationToken);
        status.BaseBranch = string.IsNullOrWhiteSpace(target) ? status.Branch : target;

        var viewArgs = isGitLab
            ? "mr view --output json"
            : "pr view --json number,title,url,state,isDraft,baseRefName,headRefName";
        var (viewCode, viewOutput) = await RunToolAsync(runner, $"{status.Tool} {viewArgs}", cancellationToken: cancellationToken);
        if (viewCode != 0)
        {
            status.Message = FirstLine(viewOutput);
            return status;
        }
        status.Pr = ParsePr(status.Host!, viewOutput);
        return status;
    }

    /// <summary>创建 PR / MR（目标分支留空用远端默认分支），成功后回传刷新后的状态</summary>
    public async Task<WorkPrCommandResultDto> CreatePrAsync(Guid projectId, CreateWorkPrRequest request, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var status = await GetPrStatusAsync(projectId, sessionId, cancellationToken);
        if (!status.IsRepo) return new WorkPrCommandResultDto { Success = false, Output = "当前目录不是 git 仓库", Status = status };
        if (status.Tool == null) return new WorkPrCommandResultDto { Success = false, Output = "远端不是 GitHub / GitLab，暂不支持创建 PR", Status = status };
        if (!status.ToolInstalled) return new WorkPrCommandResultDto { Success = false, Output = $"{status.Tool} 未安装：{status.InstallHint}", Status = status };
        if (string.IsNullOrWhiteSpace(request.Title)) return new WorkPrCommandResultDto { Success = false, Output = "标题不能为空", Status = status };

        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return new WorkPrCommandResultDto { Success = false, Output = "项目不存在", Status = status };

        var baseBranch = string.IsNullOrWhiteSpace(request.BaseBranch) ? status.BaseBranch : request.BaseBranch!.Trim();
        var args = status.Tool == "gitlab"
            ? $"mr create --title {ShellQuote(request.Title)} --target-branch {ShellQuote(baseBranch ?? "")} --description {ShellQuote(request.Body ?? string.Empty)} --yes"
                + (request.Draft ? " --draft" : string.Empty)
            : $"pr create --title {ShellQuote(request.Title)} --base {ShellQuote(baseBranch ?? "")} --body-file -"
                + (request.Draft ? " --draft" : string.Empty);

        var (code, output) = await RunToolAsync(
            runner, $"{status.Tool} {args}", status.Tool == "gh" ? request.Body ?? string.Empty : null, cancellationToken);
        var refreshed = await GetPrStatusAsync(projectId, sessionId, cancellationToken);
        return new WorkPrCommandResultDto { Success = code == 0, Output = output.Trim(), Status = refreshed };
    }

    /// <summary>远端地址解析出主机名（支持 https://host/... 与 git@host:owner/repo.git）</summary>
    private static string? ParseRemoteHost(string remoteUrl)
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

    /// <summary>当前系统的 CLI 安装命令（引导用户安装）</summary>
    private static string InstallHint(string tool)
    {
        if (OperatingSystem.IsWindows()) return tool == "gh" ? "winget install --id GitHub.cli" : "scoop install glab";
        if (OperatingSystem.IsMacOS()) return $"brew install {tool}";
        return $"sudo apt install {tool}";
    }

    /// <summary>解析 gh / glab 的 JSON 输出</summary>
    private static WorkPrInfoDto? ParsePr(string host, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string? text(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            bool flag(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
            if (host == "gitlab")
            {
                return new WorkPrInfoDto
                {
                    Number = root.TryGetProperty("iid", out var iid) && iid.ValueKind == JsonValueKind.Number ? iid.GetInt32() : 0,
                    Title = text("title") ?? string.Empty,
                    Url = text("web_url") ?? string.Empty,
                    State = text("state") ?? string.Empty,
                    IsDraft = flag("draft") || flag("work_in_progress"),
                    BaseBranch = text("target_branch"),
                    HeadBranch = text("source_branch"),
                };
            }
            return new WorkPrInfoDto
            {
                Number = root.TryGetProperty("number", out var number) && number.ValueKind == JsonValueKind.Number ? number.GetInt32() : 0,
                Title = text("title") ?? string.Empty,
                Url = text("url") ?? string.Empty,
                State = text("state") ?? string.Empty,
                IsDraft = flag("isDraft"),
                BaseBranch = text("baseRefName"),
                HeadBranch = text("headRefName"),
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>为本机 shell（PowerShell / bash）转义参数</summary>
    private static string ShellQuote(string value)
        => OperatingSystem.IsWindows()
            ? $"'{value.Replace("'", "''")}'"
            : $"'{value.Replace("'", "'\\''")}'";

    /// <summary>执行 gh / glab 这类非 git 命令（给网络留出更长超时）</summary>
    private async Task<(int ExitCode, string Output)> RunToolAsync(
        IWorkCommandRunner runner, string command, string? stdin = null, CancellationToken cancellationToken = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var timeout = TimeSpan.FromMinutes(2);
        cts.CancelAfter(timeout);
        try
        {
            var result = await runner.RunAsync(command, stdin, cts.Token, timeout);
            return (result.ExitCode, result.Combined);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (-1, "命令超时（网络较慢时请在终端里手动执行）");
        }
    }

    /// <summary>默认目标分支：origin/HEAD → origin/main|master → 当前分支（去掉 remote 前缀）</summary>
    private async Task<string?> ResolveIntegrationRefAsync(IWorkCommandRunner runner, CancellationToken cancellationToken)
    {
        var (headCode, head) = await RunGitAsync(runner, "symbolic-ref --short refs/remotes/origin/HEAD", cancellationToken: cancellationToken);
        if (headCode == 0 && !string.IsNullOrWhiteSpace(head)) return StripRemote(head.Trim());

        foreach (var candidate in new[] { "origin/main", "origin/master" })
        {
            var (code, _) = await RunGitAsync(runner, $"rev-parse --verify --quiet {candidate}", cancellationToken: cancellationToken);
            if (code == 0) return StripRemote(candidate);
        }

        var (branchCode, branch) = await RunGitAsync(runner, "rev-parse --abbrev-ref HEAD", cancellationToken: cancellationToken);
        return branchCode == 0 ? branch.Trim() : null;
    }

    private static string StripRemote(string reference)
    {
        var slash = reference.IndexOf('/');
        return slash > 0 ? reference[(slash + 1)..] : reference;
    }

    private static string? FirstLine(string? output)
        => output?.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();

    public async Task<WorkGitFileContentDto?> GetFileContentAsync(Guid projectId, string path, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return null;
        var root = runner.RootPath;
        var relative = NormalizeRelativePath(root, path);

        var status = await GetStatusAsync(projectId, sessionId, cancellationToken);
        var entry = status.Files.FirstOrDefault(f => f.Path == relative);
        var code = entry?.Status ?? "M";

        var result = new WorkGitFileContentDto { Path = relative, Status = code };

        if (code != "??" && code != "A")
        {
            var (headCode, headOutput) = await RunGitAsync(runner, $"show HEAD:\"{relative}\"", cancellationToken: cancellationToken);
            if (headCode == 0) result.OldContent = headOutput;
        }

        if (runner.IsRemote)
        {
            var cat = await runner.RunAsync($"cat \"{relative}\"", ct: cancellationToken);
            if (cat.ExitCode == 0)
            {
                result.IsBinary = cat.StdOut.Take(4096).Any(c => c == '\0');
                result.NewContent = result.IsBinary ? null : cat.StdOut;
            }
        }
        else
        {
            var full = Path.Combine(root, relative);
            if (File.Exists(full))
            {
                var bytes = await File.ReadAllBytesAsync(full, cancellationToken);
                result.IsBinary = bytes.Take(4096).Any(b => b == 0);
                result.NewContent = result.IsBinary ? null : Encoding.UTF8.GetString(bytes);
            }
        }
        return result;
    }

    public async Task<WorkGitCommitResultDto> CommitAsync(Guid projectId, WorkGitCommitRequest request, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return new WorkGitCommitResultDto { Success = false, Output = "项目不存在" };
        if (string.IsNullOrWhiteSpace(request.Message)) return new WorkGitCommitResultDto { Success = false, Output = "提交信息不能为空" };
        if (request.Paths.Count == 0) return new WorkGitCommitResultDto { Success = false, Output = "未选择要提交的文件" };

        var normalized = request.Paths.Select(p => NormalizeRelativePath(runner.RootPath, p)).ToList();

        var addArgs = "add -- " + string.Join(' ', normalized.Select(p => $"\"{p}\""));
        var (addCode, addOutput) = await RunGitAsync(runner, addArgs, cancellationToken: cancellationToken);
        if (addCode != 0) return new WorkGitCommitResultDto { Success = false, Output = addOutput };

        // 通过 stdin 传提交信息，避免特殊字符与命令行长度问题
        var (commitCode, commitOutput) = await RunGitAsync(runner, "commit -F -", stdin: request.Message, cancellationToken: cancellationToken);
        return new WorkGitCommitResultDto { Success = commitCode == 0, Output = commitOutput };
    }
}
