using System.Diagnostics;

namespace Hetu.Core.Services.Work;

/// <summary>
/// Code 会话的独立工作树：放在仓库**同级**目录（<c>&lt;父目录&gt;/&lt;仓库名&gt;.hetu-worktrees/&lt;名字&gt;</c>），
/// 不污染仓库、也无需用户维护 .gitignore。仅支持本地项目（SSH 项目直接跳过）。
/// 名字由模型按用户首条消息决定（见 <see cref="WorktreeNameSuggester"/>），目录名与分支名同名。
/// </summary>
public class WorkWorktreeService
{
    /// <summary>工作树绝对路径（<paramref name="name"/> 既是目录名也是分支名）</summary>
    public static string ResolvePath(string projectRoot, string name)
    {
        var full = Path.GetFullPath(projectRoot);
        var parent = Path.GetDirectoryName(full) ?? full;
        var repo = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        return Path.Combine(parent, $"{repo}.hetu-worktrees", name);
    }

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

    /// <summary>把工作目录检出到指定分支；已经是该分支时什么都不做。返回 null 表示成功</summary>
    public async Task<string?> CheckoutAsync(string directory, string branch, CancellationToken cancellationToken = default)
    {
        var current = await GetCurrentBranchAsync(directory, cancellationToken);
        if (string.Equals(current, branch, StringComparison.OrdinalIgnoreCase)) return null;
        var (code, output) = await RunGitAsync(directory, $"checkout {branch}", cancellationToken);
        return code == 0 ? null : FirstLine(output);
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
        await RunGitAsync(projectRoot, "worktree prune", cancellationToken);
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

    private static string? FirstLine(string output)
        => output.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
}
