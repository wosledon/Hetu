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

    /// <summary>解析项目命令执行器；项目不存在时返回 null。</summary>
    private async Task<IWorkCommandRunner?> ResolveRunnerAsync(Guid projectId, CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
        var project = await unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null || string.IsNullOrWhiteSpace(project.RootPath)) return null;
        if (project.ConnectionType == "Ssh" && string.IsNullOrWhiteSpace(project.SshHost)) return null;
        if (project.ConnectionType != "Ssh" && !Directory.Exists(project.RootPath)) return null;
        return _runnerFactory(project);
    }

    private static async Task<(int ExitCode, string Output)> RunGitAsync(IWorkCommandRunner runner, string arguments, string? stdin = null, CancellationToken cancellationToken = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(30));
        var result = await runner.RunAsync($"git {arguments}", stdin, cts.Token);
        return (result.ExitCode, result.Combined);
    }

    private static string NormalizeRelativePath(string root, string path)
    {
        var full = Path.GetFullPath(Path.Combine(root, path));
        if (!full.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("路径越界");
        return Path.GetRelativePath(root, full).Replace('\\', '/');
    }

    public async Task<WorkGitStatusDto> GetStatusAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var status = new WorkGitStatusDto();
        var runner = await ResolveRunnerAsync(projectId, cancellationToken);
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
        return status;
    }

    public async Task<WorkGitFileContentDto?> GetFileContentAsync(Guid projectId, string path, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, cancellationToken);
        if (runner == null) return null;
        var root = runner.RootPath;
        var relative = NormalizeRelativePath(root, path);

        var status = await GetStatusAsync(projectId, cancellationToken);
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

    public async Task<WorkGitCommitResultDto> CommitAsync(Guid projectId, WorkGitCommitRequest request, CancellationToken cancellationToken = default)
    {
        var runner = await ResolveRunnerAsync(projectId, cancellationToken);
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
