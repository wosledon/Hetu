using System.Text;
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
    /// <summary>分段标记：一次连接里用 echo 分隔多条 git 只读查询的输出（分支名不含空格，不会误判）</summary>
    private const string BranchSectionMarker = "-- hetu section --";

    /// <summary>
    /// 只读 git 查询的等待上限。这类命令（rev-parse / status）正常 1s 内返回，30s 的预算只会把
    /// 链路卡死放大成界面假死 30 秒；ssh 自带 keepalive 也会在约 15s 判掉半死连接，取 15s 对齐。
    /// </summary>
    private const int GitReadTimeoutSeconds = 15;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly Func<Hetu.Core.Entities.WorkProject, IWorkCommandRunner> _runnerFactory;
    private readonly ILocalizer _localizer;

    public WorkGitService(IServiceScopeFactory scopeFactory, ILocalizer localizer, Func<Hetu.Core.Entities.WorkProject, IWorkCommandRunner>? runnerFactory = null)
    {
        _scopeFactory = scopeFactory;
        _localizer = localizer;
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

    /// <summary>
    /// 只读 git 查询：SSH 链路抖动（连接卡死 / ssh 退出码 255）时重连一次。
    /// 与 <see cref="Hetu.Core.Services.Tools.WorkRemoteFs.RunReadOnlyAsync"/> 同一策略——半死连接重连后通常立刻成功，
    /// 而一次失败就报错会让分支下拉长时间停在「读不出来」。写操作（commit/pull/push）不走这里。
    /// </summary>
    private static async Task<WorkCommandResult> RunGitReadAsync(
        IWorkCommandRunner runner, string command, CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(GitReadTimeoutSeconds));
            try
            {
                var result = await runner.RunAsync(command, null, cts.Token);
                // 255 = ssh 传输层自身失败（连不上 / 已断），不是 git 的业务退出码；本地项目不重试
                if (attempt > 0 || !runner.IsRemote || result.ExitCode != 255) return result;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                // 我们的读取超时：链路卡住，重连一次
                if (attempt > 0 || !runner.IsRemote)
                    return new WorkCommandResult(-1, string.Empty, "命令超时（网络较慢时请在终端里手动执行）");
            }
            catch (TimeoutException)
            {
                // ssh 自身超时（链路半死）：同上
                if (attempt > 0 || !runner.IsRemote)
                    return new WorkCommandResult(-1, string.Empty, "ssh 命令无响应（连接可能已断开），请检查网络后重试");
            }
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
            dto.Error = _localizer.T("work.projectNotFound");
            return dto;
        }
        if (runner.IsRemote)
            dto.WorktreeUnsupportedReason = "remote";

        // 一次连接拿当前分支 + 本地分支 + 远程分支：SSH 每开一条连接就是一次完整握手，
        // 拆成三条串行发既慢又把链路抖动的暴露面放大三倍（分支下拉假死多半发生在中招的那条上）。
        // rev-parse 而非 for-each-ref --format=%(...)：本地命令经 PowerShell 执行，%() 会被解析
        // echo 的标记必须加引号：PowerShell 把裸的 "--" 当作「参数结束」，echo -- hetu section -- 会被拆成
        // 三行输出，标记再也匹配不上——分支列表全空、当前分支变成把整套分支名吞进去的一坨
        var script = string.Join("; ", new[]
        {
            "git rev-parse --abbrev-ref HEAD",
            $"echo \"{BranchSectionMarker}\"",
            "git rev-parse --symbolic --branches",
            $"echo \"{BranchSectionMarker}\"",
            "git rev-parse --symbolic --remotes",
        });
        var result = await RunGitReadAsync(runner, script, cancellationToken);
        var sections = result.StdOut.Split(BranchSectionMarker);
        if (sections.Length < 3)
        {
            // 标记没对上（输出被 shell 改写 / 截断）：按读取失败处理，别让 sections[0] 吞掉所有分支名
            dto.Error = FirstMeaningfulLine(result.StdErr) ?? _localizer.T("work.branchReadFailed");
            return dto;
        }
        var current = sections[0].Trim();
        if (current.Length == 0)
        {
            // SSH 认证失败 / 不是 git 仓库 / git 不可用：把真实原因带回前端，别让界面只说「不是 git 仓库」
            dto.Error = FirstMeaningfulLine(result.StdErr)
                ?? FirstMeaningfulLine(result.StdOut)
                ?? _localizer.T("work.branchReadFailed");
            return dto;
        }

        dto.IsRepo = true;
        dto.Current = current;
        dto.Branches = SplitRefs(sections.Length > 1 ? sections[1] : string.Empty);
        // 远程分支（origin/main 等）：选它时按同名建本地跟踪分支；symbolic refs（origin/HEAD）不算
        dto.RemoteBranches = SplitRefs(sections.Length > 2 ? sections[2] : string.Empty)
            .Where(name => !name.EndsWith("/HEAD", StringComparison.OrdinalIgnoreCase))
            .ToList();
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

    /// <summary>取命令输出里第一行有内容的信息（SSH / git 的报错首行）</summary>
    private static string? FirstMeaningfulLine(string output)
        => output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .FirstOrDefault(line => line.Length > 0);

    /// <summary>
    /// 在项目里挂一个独立工作树（仅本地项目）。分支已存在于本地时直接检出该分支，
    /// 需要新建（<paramref name="createBranch"/>）时按 <paramref name="baseBranch"/> 派生。
    /// </summary>

    public async Task<WorkGitStatusDto> GetStatusAsync(Guid projectId, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var status = new WorkGitStatusDto();
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        if (runner == null) return status;

        // 一次 git status 同时拿到分支/上游/领先落后与文件变更：大仓库上省掉两次全量扫描
        var result = await RunGitReadAsync(runner, "git status --porcelain --branch", cancellationToken);
        if (result.ExitCode != 0) return status; // 非 git 仓库或 git 不可用
        status.IsRepo = true;

        foreach (var raw in result.StdOut.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("## ", StringComparison.Ordinal))
            {
                ParseBranchHeader(line[3..], status);
                continue;
            }
            if (line.Length < 4) continue;
            var fileCode = line[..2].Trim();
            var path = line[3..].Trim();
            // 重命名 "old -> new" 取新路径
            var arrow = path.IndexOf(" -> ", StringComparison.Ordinal);
            if (arrow >= 0) path = path[(arrow + 4)..];
            status.Files.Add(new WorkGitFileStatusDto { Path = path, Status = fileCode.Length == 0 ? "??" : fileCode });
        }
        return status;
    }

    /// <summary>解析 `git status --branch` 的 `## main...origin/main [ahead 1, behind 2]` 头</summary>
    private static void ParseBranchHeader(string header, WorkGitStatusDto status)
    {
        var bracket = header.LastIndexOf(" [", StringComparison.Ordinal);
        if (bracket >= 0 && header.EndsWith("]", StringComparison.Ordinal))
        {
            var counters = header[(bracket + 2)..^1];
            header = header[..bracket];
            foreach (var part in counters.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var bits = part.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (bits.Length == 2 && int.TryParse(bits[1], out var count))
                {
                    if (bits[0] == "ahead") status.Ahead = count;
                    else if (bits[0] == "behind") status.Behind = count;
                }
            }
        }

        const string noCommits = "No commits yet on ";
        if (header.StartsWith(noCommits, StringComparison.Ordinal))
        {
            status.Branch = header[noCommits.Length..];
            return;
        }
        if (header.StartsWith("HEAD (no branch)", StringComparison.Ordinal))
        {
            status.Branch = "HEAD";
            return;
        }
        var dots = header.IndexOf("...", StringComparison.Ordinal);
        if (dots >= 0)
        {
            status.Branch = header[..dots];
            status.Upstream = header[(dots + 3)..];
        }
        else
        {
            status.Branch = header;
        }
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
    /// 命令行与 JSON 解析统一在 <see cref="WorkPrClient"/>，与 Agent 的 work_pr 工具共用一份实现。
    /// </summary>
    public async Task<WorkPrStatusDto> GetPrStatusAsync(Guid projectId, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        return runner == null ? new WorkPrStatusDto() : await WorkPrClient.ForRunner(runner).GetStatusAsync(cancellationToken);
    }

    /// <summary>创建 PR / MR（目标分支留空用远端默认分支），成功后回传刷新后的状态</summary>
    public async Task<WorkPrCommandResultDto> CreatePrAsync(Guid projectId, CreateWorkPrRequest request, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var client = await ResolvePrClientAsync(projectId, sessionId, cancellationToken);
        if (client == null) return Failed(_localizer.T("work.projectNotFound"), new WorkPrStatusDto());

        var status = await client.GetStatusAsync(cancellationToken);
        var blocked = GuardStatus(status, requirePr: false);
        if (blocked != null) return Failed(blocked, status);
        if (string.IsNullOrWhiteSpace(request.Title)) return Failed(_localizer.T("work.prTitleRequired"), status);
        return await client.CreateAsync(request, status, cancellationToken);
    }

    /// <summary>PR 操作：转正式 / 转草稿 / 合并 / 关闭 / 重开（作用于当前分支的 PR），成功后回传刷新后的状态</summary>
    public async Task<WorkPrCommandResultDto> RunPrActionAsync(Guid projectId, WorkPrActionRequest request, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var client = await ResolvePrClientAsync(projectId, sessionId, cancellationToken);
        if (client == null) return Failed(_localizer.T("work.projectNotFound"), new WorkPrStatusDto());

        var action = (request.Action ?? string.Empty).Trim().ToLowerInvariant();
        if (action is not ("ready" or "draft" or "merge" or "close" or "reopen"))
            return Failed(_localizer.T("work.prUnknownAction", request.Action ?? string.Empty), new WorkPrStatusDto());

        var status = await client.GetStatusAsync(cancellationToken);
        var blocked = GuardStatus(status, requirePr: true);
        if (blocked != null) return Failed(blocked, status);
        return await client.RunActionAsync(request, status, cancellationToken);
    }

    /// <summary>PR 待处理反馈：失败 / 进行中的 CI 检查 + 审查意见 + 失败日志，供「交给 Agent 修」</summary>
    public async Task<WorkPrFeedbackDto> GetPrFeedbackAsync(Guid projectId, Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        var feedback = new WorkPrFeedbackDto();
        var client = await ResolvePrClientAsync(projectId, sessionId, cancellationToken);
        if (client == null)
        {
            feedback.Message = _localizer.T("work.projectNotFound");
            return feedback;
        }

        var status = await client.GetStatusAsync(cancellationToken);
        if (status.Pr == null)
        {
            feedback.Message = GuardStatus(status, requirePr: true) ?? status.Message;
            return feedback;
        }
        return await client.GetFeedbackAsync(status, cancellationToken);
    }

    /// <summary>解析项目执行器并包装成 PR 客户端；项目不存在 / 目录不可用时返回 null</summary>
    private async Task<WorkPrClient?> ResolvePrClientAsync(Guid projectId, Guid? sessionId, CancellationToken cancellationToken)
    {
        var runner = await ResolveRunnerAsync(projectId, sessionId, cancellationToken);
        return runner == null ? null : WorkPrClient.ForRunner(runner);
    }

    /// <summary>状态守卫：返回非 null 表示当前不能执行 PR 操作</summary>
    private string? GuardStatus(WorkPrStatusDto status, bool requirePr)
    {
        if (!status.IsRepo) return _localizer.T("work.prNotRepo");
        if (status.Tool == null) return _localizer.T("work.prUnsupportedHost");
        if (!status.ToolInstalled) return _localizer.T("work.prToolMissing", status.Tool, status.InstallHint ?? string.Empty);
        if (requirePr && status.Pr == null) return _localizer.T("work.prMissing");
        return null;
    }

    private static WorkPrCommandResultDto Failed(string output, WorkPrStatusDto status)
        => new() { Success = false, Output = output, Status = status };

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
