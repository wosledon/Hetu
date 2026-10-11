using System.Diagnostics;
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
        dto.Branches = refs
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(line => line, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return dto;
    }

    /// <summary>
    /// 在项目里挂一个独立工作树（仅本地项目）。分支已存在于本地时直接检出该分支，
    /// 需要新建（<paramref name="createBranch"/>）时按 <paramref name="baseBranch"/> 派生。
    /// </summary>
    public async Task<(bool Ok, string? Error)> CreateWorktreeAsync(
        Guid projectId, string worktreePath, string branch, bool createBranch, string? baseBranch,
        CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, cancellationToken);
        if (runner == null) return (false, "project-unavailable");
        if (runner.IsRemote) return (false, "remote-unsupported");

        Directory.CreateDirectory(Path.GetDirectoryName(worktreePath)!);
        var quotedPath = worktreePath.Replace('\\', '/');
        var arguments = createBranch
            ? $"worktree add -b {branch} \"{quotedPath}\" {baseBranch ?? "HEAD"}"
            : $"worktree add \"{quotedPath}\" {branch}";

        var (code, output) = await RunGitAsync(runner, arguments, cancellationToken: cancellationToken);
        if (code == 0) return (true, null);
        // 分支已被主工作区检出等场景：把 git 的原始信息回给前端展示
        var firstLine = output.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
        return (false, string.IsNullOrWhiteSpace(firstLine) ? "git-worktree-failed" : firstLine);
    }

    /// <summary>删除工作树（先 remove --force，失败再 prune；目录残留不影响主仓库）</summary>
    public async Task RemoveWorktreeAsync(Guid projectId, string worktreePath, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, cancellationToken);
        if (runner == null || runner.IsRemote) return;
        var quotedPath = worktreePath.Replace('\\', '/');
        await RunGitAsync(runner, $"worktree remove --force \"{quotedPath}\"", cancellationToken: cancellationToken);
        await RunGitAsync(runner, "worktree prune", cancellationToken: cancellationToken);
        try
        {
            if (Directory.Exists(worktreePath) && !Directory.EnumerateFileSystemEntries(worktreePath).Any())
                Directory.Delete(worktreePath);
        }
        catch (IOException)
        {
            // 目录删不掉就算了：prune 之后 git 已不再引用它
        }
    }

    /// <summary>工作树内切换分支（分支不存在时按 HEAD 新建，便于「以工作树并行开发」）</summary>
    public async Task<(bool Ok, string? Error)> SwitchBranchAsync(string directory, string branch, bool createIfMissing, CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(directory)) return (false, "worktree-missing");
        var runner = new LocalCommandRunner(directory);
        if (createIfMissing)
        {
            var (existsCode, _) = await RunGitAsync(runner, $"rev-parse --verify --quiet refs/heads/{branch}", cancellationToken: cancellationToken);
            if (existsCode != 0)
            {
                var (createCode, createOut) = await RunGitAsync(runner, $"checkout -b {branch}", cancellationToken: cancellationToken);
                return createCode == 0
                    ? (true, null)
                    : (false, createOut.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim());
            }
        }
        var (code, output) = await RunGitAsync(runner, $"checkout {branch}", cancellationToken: cancellationToken);
        return code == 0
            ? (true, null)
            : (false, output.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim());
    }

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
