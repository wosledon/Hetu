using System.Diagnostics;

namespace Hetu.Core.Services.Work;

/// <summary>
/// Code 会话的独立工作树：工作树放在仓库**同级**目录（<c>&lt;父目录&gt;/&lt;仓库名&gt;.hetu-worktrees/&lt;会话短 id&gt;</c>），
/// 不污染仓库、也无需用户维护 .gitignore。仅支持本地项目（SSH 项目直接跳过）。
/// </summary>
public class WorkWorktreeService
{
    /// <summary>工作树绝对路径（同一会话固定，便于删除时复用）</summary>
    public static string ResolvePath(string projectRoot, Guid sessionId)
    {
        var full = Path.GetFullPath(projectRoot);
        var parent = Path.GetDirectoryName(full) ?? full;
        var name = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var shortId = sessionId.ToString("N")[..8];
        return Path.Combine(parent, $"{name}.hetu-worktrees", shortId);
    }

    /// <summary>默认派生分支名：hetu/&lt;会话短 id&gt;</summary>
    public static string DeriveBranchName(Guid sessionId) => $"hetu/{sessionId.ToString("N")[..8]}";

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

    public async Task<List<string>> ListBranchesAsync(string projectRoot, CancellationToken cancellationToken = default)
    {
        // 用 rev-parse 而不是 for-each-ref --format=%(...)：本地命令经 PowerShell 执行，%() 会被 PowerShell 解析
        var (code, output) = await RunGitAsync(projectRoot, "rev-parse --symbolic --branches", cancellationToken);
        if (code != 0) return [];
        return output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(line => line, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>挂工作树：分支已存在直接检出；<paramref name="createBranch"/> 为 true 时按 <paramref name="baseBranch"/> 新建</summary>
    public async Task<(bool Ok, string? Error)> CreateAsync(
        string projectRoot, string worktreePath, string branch, bool createBranch, string? baseBranch,
        CancellationToken cancellationToken = default)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(worktreePath)!);
        }
        catch (IOException ex)
        {
            return (false, ex.Message);
        }

        var path = worktreePath.Replace('\\', '/');
        var arguments = createBranch
            ? $"worktree add -b {branch} \"{path}\" {baseBranch ?? "HEAD"}"
            : $"worktree add \"{path}\" {branch}";

        var (code, output) = await RunGitAsync(projectRoot, arguments, cancellationToken);
        if (code == 0) return (true, null);
        return (false, FirstLine(output));
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

    /// <summary>工作树内切分支（<paramref name="createIfMissing"/> 时不存在则按 HEAD 新建）</summary>
    public async Task<(bool Ok, string? Error)> SwitchBranchAsync(
        string worktreePath, string branch, bool createIfMissing, CancellationToken cancellationToken = default)
    {
        if (createIfMissing)
        {
            var (existsCode, _) = await RunGitAsync(worktreePath, $"rev-parse --verify --quiet refs/heads/{branch}", cancellationToken);
            if (existsCode != 0)
            {
                var (createCode, createOut) = await RunGitAsync(worktreePath, $"checkout -b {branch}", cancellationToken);
                return createCode == 0 ? (true, null) : (false, FirstLine(createOut));
            }
        }
        var (code, output) = await RunGitAsync(worktreePath, $"checkout {branch}", cancellationToken);
        return code == 0 ? (true, null) : (false, FirstLine(output));
    }

    private static string? FirstLine(string output)
        => output.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
}
