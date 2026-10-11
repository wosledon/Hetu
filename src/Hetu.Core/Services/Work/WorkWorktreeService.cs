using System.Diagnostics;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Work;

/// <summary>
/// Code 会话的独立工作树位置解析。默认统一放在**仓库父目录下的一个文件夹**里
/// （<c>&lt;父目录&gt;/.hetu-worktrees/&lt;仓库名&gt;/&lt;名字&gt;</c>），脏目录只有这一个，不会在父目录里
/// 给每个仓库各堆一个 <c>&lt;仓库名&gt;.hetu-worktrees</c>；也可在设置里指定别的根目录。
/// 名字由模型按用户首条消息决定（见 <see cref="WorktreeNameSuggester"/>），目录名与分支名同名。
/// </summary>
public class WorkWorktreeService
{
    private const string LocationConfigKey = "WorktreeConfig";

    /// <summary>父目录下统一存放工作树的文件夹名</summary>
    private const string SharedFolderName = ".hetu-worktrees";

    private readonly IAppSettingService _appSettings;

    public WorkWorktreeService(IAppSettingService appSettings) => _appSettings = appSettings;

    /// <summary>仓库名（用作统一文件夹下的子目录名）</summary>
    public static string RepoName(string projectRoot)
    {
        var full = Path.GetFullPath(projectRoot);
        return Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
    }

    /// <summary>仓库父目录</summary>
    public static string ParentDirectory(string projectRoot)
    {
        var full = Path.GetFullPath(projectRoot);
        return Path.GetDirectoryName(full) ?? full;
    }

    /// <summary>默认的统一工作树根目录：<c>&lt;仓库父目录&gt;/.hetu-worktrees</c></summary>
    public static string DefaultRoot(string projectRoot)
        => Path.Combine(ParentDirectory(projectRoot), SharedFolderName);

    /// <summary>旧版默认位置：仓库同级的 <c>&lt;仓库名&gt;.hetu-worktrees</c>（现在只用于清理遗留目录）</summary>
    public static string LegacyRoot(string projectRoot)
        => Path.Combine(ParentDirectory(projectRoot), $"{RepoName(projectRoot)}.hetu-worktrees");

    /// <summary>配置的工作树根目录（未配置时返回 null）</summary>
    public async Task<string?> GetConfiguredRootAsync(CancellationToken cancellationToken = default)
    {
        var setting = await _appSettings.GetAsync(LocationConfigKey, cancellationToken);
        var value = setting.Data?.Value;
        if (string.IsNullOrWhiteSpace(value)) return null;
        try
        {
            var config = System.Text.Json.JsonSerializer.Deserialize<Hetu.Shared.Settings.WorktreeConfigDto>(value);
            var root = config?.RootDirectory?.Trim();
            return string.IsNullOrWhiteSpace(root) ? null : root;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }

    /// <summary>项目的工作树根目录：配置优先，其次仓库父目录下的统一文件夹（每个仓库一层子目录）</summary>
    public async Task<string> ResolveRootAsync(string projectRoot, CancellationToken cancellationToken = default)
    {
        var configured = await GetConfiguredRootAsync(cancellationToken);
        var baseRoot = string.IsNullOrWhiteSpace(configured) ? DefaultRoot(projectRoot) : Path.GetFullPath(configured);
        return Path.Combine(baseRoot, RepoName(projectRoot));
    }

    /// <summary>工作树绝对路径（<paramref name="name"/> 既是目录名也是分支名）</summary>
    public async Task<string> ResolvePathAsync(string projectRoot, string name, CancellationToken cancellationToken = default)
        => Path.Combine(await ResolveRootAsync(projectRoot, cancellationToken), name);

    private static async Task<(int ExitCode, string Output)> RunGitAsync(string directory, string arguments, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(directory)) return (1, "directory-missing");
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(60));
        var result = await new LocalCommandRunner(directory).RunAsync($"git {arguments}", null, cts.Token);
        return (result.ExitCode, result.Combined);
    }

    public async Task<bool> IsGitRepoAsync(string projectRoot, CancellationToken cancellationToken = default)
    {
        var (code, _) = await RunGitAsync(projectRoot, "rev-parse --git-dir", cancellationToken);
        return code == 0;
    }

    public async Task<string?> GetCurrentBranchAsync(string directory, CancellationToken cancellationToken = default)
    {
        var (code, output) = await RunGitAsync(directory, "rev-parse --abbrev-ref HEAD", cancellationToken);
        return code == 0 ? output.Trim() : null;
    }

    /// <summary>分支是否已存在（本地分支）</summary>
    public async Task<bool> BranchExistsAsync(string projectRoot, string branch, CancellationToken cancellationToken = default)
    {
        var (code, _) = await RunGitAsync(projectRoot, $"rev-parse --verify --quiet refs/heads/{branch}", cancellationToken);
        return code == 0;
    }

    /// <summary>
    /// 挂出工作树：优先直接检出 <paramref name="baseBranch"/>；该分支已被别处检出（git 不允许两处同分支）时，
    /// 改用 <paramref name="fallbackBranch"/> 从它新建分支。返回真正检出的分支名。
    /// </summary>
    public async Task<(bool Ok, string? Error, string? Branch)> CreateAsync(
        string projectRoot, string worktreePath, string fallbackBranch, string? baseBranch,
        CancellationToken cancellationToken = default)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(worktreePath)!);
        }
        catch (IOException ex)
        {
            return (false, ex.Message, null);
        }

        var path = worktreePath.Replace('\\', '/');
        // 远程引用（origin/feature-x）：直接检出会进 detached HEAD，改为按它建本地跟踪分支
        var useRemoteBase = !string.IsNullOrWhiteSpace(baseBranch) && await IsRemoteRefAsync(projectRoot, baseBranch!, cancellationToken);
        if (useRemoteBase)
        {
            var local = LocalNameOf(baseBranch!);
            if (!await BranchExistsAsync(projectRoot, local, cancellationToken))
            {
                var (trackCode, trackOut) = await RunGitAsync(
                    projectRoot, $"worktree add -b {local} \"{path}\" {baseBranch}", cancellationToken);
                if (trackCode == 0) return (true, null, local);
                await RunGitAsync(projectRoot, "worktree prune", cancellationToken);
                TryDeleteDirectory(worktreePath);
                return (false, FirstLine(trackOut), null);
            }
            baseBranch = local;
        }

        if (!string.IsNullOrWhiteSpace(baseBranch))
        {
            var (code, _) = await RunGitAsync(projectRoot, $"worktree add \"{path}\" {baseBranch}", cancellationToken);
            if (code == 0) return (true, null, baseBranch);
            // 直接检出失败（通常是被主工作区占用）：清掉可能的残留目录与元数据后改新建分支
            await RunGitAsync(projectRoot, "worktree prune", cancellationToken);
            TryDeleteDirectory(worktreePath);
        }

        var (newCode, newOutput) = await RunGitAsync(
            projectRoot, $"worktree add -b {fallbackBranch} \"{path}\" {baseBranch ?? "HEAD"}", cancellationToken);
        return newCode == 0 ? (true, null, fallbackBranch) : (false, FirstLine(newOutput), null);
    }

    /// <summary>
    /// 把工作目录检出到指定分支；已经是该分支时什么都不做。返回 null 表示成功。
    /// <paramref name="branch"/> 可以是远程引用（origin/feature-x）：本地没有同名分支时按远程建跟踪分支。
    /// </summary>
    public async Task<string?> CheckoutAsync(string projectRoot, string branch, CancellationToken cancellationToken = default)
    {
        if (await IsRemoteRefAsync(projectRoot, branch, cancellationToken))
        {
            var local = LocalNameOf(branch);
            if (!await BranchExistsAsync(projectRoot, local, cancellationToken))
            {
                var (createCode, createOut) = await RunGitAsync(projectRoot, $"checkout -b {local} {branch}", cancellationToken);
                return createCode == 0 ? null : FirstLine(createOut);
            }
            branch = local;
        }

        var current = await GetCurrentBranchAsync(projectRoot, cancellationToken);
        if (string.Equals(current, branch, StringComparison.OrdinalIgnoreCase)) return null;
        var (code, output) = await RunGitAsync(projectRoot, $"checkout {branch}", cancellationToken);
        return code == 0 ? null : FirstLine(output);
    }

    /// <summary>是否形如 <c>&lt;remote&gt;/&lt;branch&gt;</c> 的远程引用（<c>&lt;remote&gt;</c> 必须是真实远程名）</summary>
    public async Task<bool> IsRemoteRefAsync(string projectRoot, string branch, CancellationToken cancellationToken = default)
    {
        var slash = branch.IndexOf('/');
        if (slash <= 0) return false;
        var (code, remotes) = await RunGitAsync(projectRoot, "remote", cancellationToken);
        if (code != 0) return false;
        return remotes
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(r => r.Trim())
            .Any(r => string.Equals(r, branch[..slash], StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>远程引用对应的本地分支名（origin/feature-x → feature-x）</summary>
    public static string LocalNameOf(string remoteRef)
    {
        var slash = remoteRef.IndexOf('/');
        return slash > 0 ? remoteRef[(slash + 1)..] : remoteRef;
    }

    /// <summary>工作目录是否干净（含未跟踪文件）</summary>
    public async Task<bool> IsCleanAsync(string directory, CancellationToken cancellationToken = default)
    {
        var (code, output) = await RunGitAsync(directory, "status --porcelain", cancellationToken);
        return code == 0 && string.IsNullOrWhiteSpace(output);
    }

    /// <summary>分支是否已全部并入 <paramref name="target"/>（无独有提交）</summary>
    public async Task<bool> IsContainedInAsync(string directory, string branch, string target, CancellationToken cancellationToken = default)
    {
        if (string.Equals(branch, target, StringComparison.OrdinalIgnoreCase)) return true;
        var (code, output) = await RunGitAsync(directory, $"rev-list --count {target}..{branch}", cancellationToken);
        return code == 0 && int.TryParse(output.Trim(), out var count) && count == 0;
    }

    /// <summary>
    /// 分支曾推送过、但远端已没有它（常见于 PR 合并后删除分支）：算「已完成」。
    /// 没有上游配置、或远端不可达（离线/无网）时返回 false，避免误判。
    /// </summary>
    public async Task<bool> WasPushTargetDeletedAsync(string projectRoot, string branch, CancellationToken cancellationToken = default)
    {
        var (remoteCode, remote) = await RunGitAsync(projectRoot, $"config --get branch.{branch}.remote", cancellationToken);
        if (remoteCode != 0 || string.IsNullOrWhiteSpace(remote)) return false;

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(20));
        try
        {
            var (code, output) = await RunGitAsync(
                projectRoot, $"ls-remote --heads {remote.Trim()} refs/heads/{branch}", cts.Token);
            return code == 0 && string.IsNullOrWhiteSpace(output);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>删除本地分支（工作树移除后调用；失败忽略，例如分支仍被别处检出）</summary>
    public async Task DeleteBranchAsync(string projectRoot, string branch, CancellationToken cancellationToken = default)
        => await RunGitAsync(projectRoot, $"branch -D {branch}", cancellationToken);

    /// <summary>
    /// 判断「已完成」时的参照分支：优先 origin/HEAD（远端默认分支），其次 origin/main、origin/master，
    /// 都没有时退回当前分支（纯本地仓库）。
    /// </summary>
    public async Task<string> ResolveIntegrationRefAsync(string projectRoot, CancellationToken cancellationToken = default)
    {
        var (headCode, head) = await RunGitAsync(projectRoot, "symbolic-ref --short refs/remotes/origin/HEAD", cancellationToken);
        if (headCode == 0 && !string.IsNullOrWhiteSpace(head)) return head.Trim();

        foreach (var candidate in new[] { "origin/main", "origin/master" })
        {
            var (code, _) = await RunGitAsync(projectRoot, $"rev-parse --verify --quiet {candidate}", cancellationToken);
            if (code == 0) return candidate;
        }

        return await GetCurrentBranchAsync(projectRoot, cancellationToken) ?? "HEAD";
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch (IOException)
        {
            // 删不掉也不影响：git 已 prune，目录会被当普通空目录
        }
    }

    /// <summary>删除工作树（remove --force + prune；空目录顺手删掉，删不掉也不影响主仓库）</summary>
    public async Task RemoveAsync(string projectRoot, string worktreePath, CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(projectRoot)) return;
        var path = worktreePath.Replace('\\', '/');
        await RunGitAsync(projectRoot, $"worktree remove --force \"{path}\"", cancellationToken);
        await PruneAsync(projectRoot, cancellationToken);
        try
        {
            if (Directory.Exists(worktreePath) && !Directory.EnumerateFileSystemEntries(worktreePath).Any())
                Directory.Delete(worktreePath);
        }
        catch (IOException)
        {
            // 忽略：prune 后 git 已不再引用该目录
        }
    }

    /// <summary>清理工作树元数据：目录被手工删除后 git 仍记着它，prune 丢掉这些记录</summary>
    public Task PruneAsync(string projectRoot, CancellationToken cancellationToken = default)
        => RunGitAsync(projectRoot, "worktree prune", cancellationToken);

    private static string? FirstLine(string output)
        => output.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
}
