using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Work;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>工作项目文件系统浏览（本地项目直接读写；SSH 项目通过 ssh 客户端执行）</summary>
[ApiController]
[Route("api/work-projects/{projectId:guid}/fs")]
public class WorkFilesController : ControllerBase
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly Func<WorkProject, IWorkCommandRunner> _runnerFactory;
    private readonly ILocalizer _localizer;

    public WorkFilesController(IServiceScopeFactory scopeFactory, ILocalizer localizer, Func<WorkProject, IWorkCommandRunner>? runnerFactory = null)
    {
        _scopeFactory = scopeFactory;
        _localizer = localizer;
        _runnerFactory = runnerFactory ?? (p => p.ConnectionType == "Ssh"
            ? new SshCommandRunner(p, _ => null)
            : new LocalCommandRunner(p.RootPath));
    }

    private static readonly HashSet<string> BinaryExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".dll", ".exe", ".zip", ".7z", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".eot", ".db", ".sqlite", ".node", ".map",
    };

    [HttpGet("list")]
    public async Task<ApiResponse<List<WorkFileEntryDto>>> List(Guid projectId, [FromQuery] string? path, [FromQuery] Guid? session, CancellationToken cancellationToken)
    {
        var runner = await ResolveRunnerAsync(projectId, session, cancellationToken);
        if (runner == null) return ApiResponse<List<WorkFileEntryDto>>.Fail(_localizer.T("work.projectNotFound"));

        var relative = NormalizeRelative(runner.RootPath, path ?? "");
        if (relative == null) return ApiResponse<List<WorkFileEntryDto>>.Fail(_localizer.T("work.pathOutOfProject"));

        try
        {
            if (!runner.IsRemote)
            {
                var dir = Path.Combine(runner.RootPath, relative);
                if (!Directory.Exists(dir)) return ApiResponse<List<WorkFileEntryDto>>.Fail(_localizer.T("work.dirNotFound"));

                var entries = new List<WorkFileEntryDto>();
                foreach (var d in Directory.GetDirectories(dir))
                {
                    var di = new DirectoryInfo(d);
                    entries.Add(new WorkFileEntryDto
                    {
                        Name = di.Name,
                        Path = Path.GetRelativePath(runner.RootPath, di.FullName).Replace('\\', '/'),
                        IsDirectory = true,
                        ModifiedAt = di.LastWriteTimeUtc
                    });
                }
                foreach (var f in Directory.GetFiles(dir))
                {
                    var fi = new FileInfo(f);
                    entries.Add(new WorkFileEntryDto
                    {
                        Name = fi.Name,
                        Path = Path.GetRelativePath(runner.RootPath, fi.FullName).Replace('\\', '/'),
                        IsDirectory = false,
                        Size = fi.Length,
                        ModifiedAt = fi.LastWriteTimeUtc
                    });
                }
                return ApiResponse<List<WorkFileEntryDto>>.Ok(entries
                    .OrderByDescending(e => e.IsDirectory)
                    .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
                    .ToList());
            }

            // 远端：GNU find -printf，失败回退 BSD stat（只读重试：链路抖动时重连一次）
            var quoted = SshCommandRunner.ShellQuote(RelativeToRemotePath(runner.RootPath, relative));
            var gnucmd = $"find {quoted} -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%TY-%Tm-%TdT%TH:%TM:%TS\\t%f\\n'";
            var result = await WorkRemoteFs.RunReadOnlyAsync(runner, gnucmd, cancellationToken);
            if (result.ExitCode != 0)
            {
                var bsdcmd = $"find {quoted} -maxdepth 1 -mindepth 1 -exec stat -f '%HT\\t%z\\t%Sm\\t%N' {{}} +";
                result = await WorkRemoteFs.RunReadOnlyAsync(runner, bsdcmd, cancellationToken);
                if (result.ExitCode != 0)
                    return ApiResponse<List<WorkFileEntryDto>>.Fail(_localizer.T("work.readDirFailed", FirstLine(result.StdErr) ?? _localizer.T("work.remoteCommandFailed")));
            }

            var list = new List<WorkFileEntryDto>();
            foreach (var line in result.StdOut.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = line.TrimEnd('\r').Split('\t');
                if (parts.Length < 4) continue;
                var isDir = parts[0] is "d" or "Directory";
                var size = long.TryParse(parts[1], out var s) ? s : 0;
                var name = parts[^1];
                if (name is "." or "..") continue;
                var modified = DateTimeOffset.TryParse(parts[2], out var dt) ? dt.ToUniversalTime() : DateTimeOffset.UnixEpoch;
                list.Add(new WorkFileEntryDto
                {
                    Name = name,
                    Path = (relative.Length == 0 ? "" : relative + "/") + name,
                    IsDirectory = isDir,
                    Size = isDir ? 0 : size,
                    ModifiedAt = modified
                });
            }
            return ApiResponse<List<WorkFileEntryDto>>.Ok(list
                .OrderByDescending(e => e.IsDirectory)
                .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
                .ToList());
        }
        catch (Exception ex)
        {
            return ApiResponse<List<WorkFileEntryDto>>.Fail(_localizer.T("work.readDirFailed", ex.Message));
        }
    }

    [HttpGet("read")]
    public async Task<ApiResponse<WorkFileContentDto>> Read(Guid projectId, [FromQuery] string path, [FromQuery] Guid? session, CancellationToken cancellationToken)
    {
        var runner = await ResolveRunnerAsync(projectId, session, cancellationToken);
        if (runner == null) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.projectNotFound"));

        var relative = NormalizeRelative(runner.RootPath, path ?? "");
        if (relative == null) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.pathOutOfProject"));

        try
        {
            if (!runner.IsRemote)
            {
                var file = Path.Combine(runner.RootPath, relative);
                if (!System.IO.File.Exists(file)) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.fileNotFound"));

                var fi = new FileInfo(file);
                var ext = fi.Extension.ToLowerInvariant();
                var isBinary = BinaryExts.Contains(ext) || fi.Length > 2 * 1024 * 1024;
                string? content = null;
                if (!isBinary) content = await System.IO.File.ReadAllTextAsync(file, cancellationToken);
                return ApiResponse<WorkFileContentDto>.Ok(new WorkFileContentDto
                {
                    Path = relative,
                    Name = fi.Name,
                    Size = fi.Length,
                    IsBinary = isBinary,
                    Content = content,
                    ModifiedAt = fi.LastWriteTimeUtc
                });
            }

            // 远端：base64 传输避免二进制与编码问题
            var quoted = SshCommandRunner.ShellQuote(RelativeToRemotePath(runner.RootPath, relative));
            var sizeCmd = await WorkRemoteFs.RunReadOnlyAsync(runner, $"wc -c < {quoted}", cancellationToken);
            if (sizeCmd.ExitCode != 0) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.fileNotFound"));
            var size = long.TryParse(sizeCmd.StdOut.Trim(), out var sz) ? sz : 0;
            var ext2 = Path.GetExtension(relative).ToLowerInvariant();
            var isBinary2 = BinaryExts.Contains(ext2) || size > 2 * 1024 * 1024;

            var name = Path.GetFileName(relative);
            if (isBinary2)
            {
                return ApiResponse<WorkFileContentDto>.Ok(new WorkFileContentDto
                {
                    Path = relative, Name = name, Size = size, IsBinary = true, Content = null,
                });
            }

            var b64 = await WorkRemoteFs.RunReadOnlyAsync(runner, $"base64 < {quoted}", cancellationToken);
            if (b64.ExitCode != 0) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.readFileFailed", FirstLine(b64.StdErr) ?? _localizer.T("work.remoteCommandFailed")));
            var content2 = Encoding.UTF8.GetString(Convert.FromBase64String(b64.StdOut.Replace("\n", "").Replace("\r", "")));
            return ApiResponse<WorkFileContentDto>.Ok(new WorkFileContentDto
            {
                Path = relative, Name = name, Size = size, IsBinary = false, Content = content2,
            });
        }
        catch (Exception ex)
        {
            return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.readFileFailed", ex.Message));
        }
    }

    /// <summary>项目内文件名/内容搜索（本地遵守忽略规则；远端用 grep/find）</summary>
    [HttpGet("search")]
    public async Task<ApiResponse<List<WorkFileSearchHitDto>>> Search(
        Guid projectId,
        [FromQuery] string query,
        [FromQuery] int limit,
        [FromQuery] Guid? session,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query)) return ApiResponse<List<WorkFileSearchHitDto>>.Ok([]);

        var runner = await ResolveRunnerAsync(projectId, session, cancellationToken);
        if (runner == null) return ApiResponse<List<WorkFileSearchHitDto>>.Fail(_localizer.T("work.projectNotFound"));

        var max = Math.Clamp(limit <= 0 ? 60 : limit, 1, 200);
        var needle = query.Trim();

        if (!runner.IsRemote)
        {
            var hits = new List<WorkFileSearchHitDto>();
            var scanned = 0;

            // 先按文件名匹配，保证定位类搜索优先生效
            foreach (var file in EnumerateProjectFiles(runner.RootPath, cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (++scanned > 20000 || hits.Count >= max) break;

                var relative = Path.GetRelativePath(runner.RootPath, file).Replace('\\', '/');
                if (relative.Contains(needle, StringComparison.OrdinalIgnoreCase))
                    hits.Add(new WorkFileSearchHitDto { Path = relative, Line = 0, Text = Path.GetFileName(file) });
            }

            if (hits.Count < max)
            {
                var remaining = max - hits.Count;
                foreach (var file in EnumerateProjectFiles(runner.RootPath, cancellationToken))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (remaining <= 0) break;
                    if (!WorkProjectRules.IsProbablyText(file)) continue;

                    string[] lines;
                    try { lines = await System.IO.File.ReadAllLinesAsync(file, cancellationToken); }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }

                    var relative = Path.GetRelativePath(runner.RootPath, file).Replace('\\', '/');
                    for (var i = 0; i < lines.Length && remaining > 0; i++)
                    {
                        var index = lines[i].IndexOf(needle, StringComparison.OrdinalIgnoreCase);
                        if (index < 0) continue;

                        var text = lines[i].Trim();
                        if (text.Length > 200) text = text[..200] + "…";
                        hits.Add(new WorkFileSearchHitDto { Path = relative, Line = i + 1, Text = text });
                        remaining--;
                    }
                }
            }
            return ApiResponse<List<WorkFileSearchHitDto>>.Ok(hits);
        }

        // 远端：文件名匹配 + grep 内容匹配
        var hits2 = new List<WorkFileSearchHitDto>();
        var q = SshCommandRunner.ShellQuote($"*{needle}*");
        var nameResult = await WorkRemoteFs.RunReadOnlyAsync(runner, 
            $"find . -path ./.git -prune -o -name {q} -print 2>/dev/null | head -n {max}", cancellationToken);
        foreach (var line in nameResult.StdOut.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var p = line.Trim().TrimStart('.').TrimStart('/');
            if (p.Length == 0) continue;
            hits2.Add(new WorkFileSearchHitDto { Path = p, Line = 0, Text = Path.GetFileName(p) });
            if (hits2.Count >= max) return ApiResponse<List<WorkFileSearchHitDto>>.Ok(hits2);
        }

        var pattern = needle.Replace("'", "'\\''");
        var grepResult = await WorkRemoteFs.RunReadOnlyAsync(runner, 
            $"grep -rIn --exclude-dir=.git -m {max} -e '{pattern}' . 2>/dev/null | head -n {max}", cancellationToken);
        foreach (var line in grepResult.StdOut.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = line.TrimEnd('\r');
            var sep = trimmed.IndexOf(':');
            if (sep <= 0) continue;
            var file = trimmed[..sep].TrimStart('.').TrimStart('/');
            var rest = trimmed[(sep + 1)..];
            var sep2 = rest.IndexOf(':');
            if (sep2 <= 0) continue;
            if (!int.TryParse(rest[..sep2], out var lineNo)) continue;
            var text = rest[(sep2 + 1)..].Trim();
            if (text.Length > 200) text = text[..200] + "…";
            hits2.Add(new WorkFileSearchHitDto { Path = file, Line = lineNo, Text = text });
            if (hits2.Count >= max) break;
        }
        return ApiResponse<List<WorkFileSearchHitDto>>.Ok(hits2);
    }

    /// <summary>写入/覆盖项目内文本文件（本地编辑器保存；SSH 项目经 base64 写入）</summary>
    [HttpPut("write")]
    public async Task<ApiResponse<WorkFileContentDto>> Write(Guid projectId, [FromBody] WriteWorkFileRequest request, [FromQuery] Guid? session, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Path)) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.pathRequired"));

        var runner = await ResolveRunnerAsync(projectId, session, cancellationToken);
        if (runner == null) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.projectNotFound"));

        var relative = NormalizeRelative(runner.RootPath, request.Path);
        if (relative == null) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.pathOutOfProject"));

        var content = request.Content ?? string.Empty;
        if (content.Length > 2 * 1024 * 1024) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.fileTooLarge"));

        try
        {
            if (!runner.IsRemote)
            {
                var file = Path.Combine(runner.RootPath, relative);
                if (Directory.Exists(file)) return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.targetIsDirectory"));

                if (System.IO.File.Exists(file) && request.OriginalContent != null)
                {
                    var current = await System.IO.File.ReadAllTextAsync(file, cancellationToken);
                    if (current != request.OriginalContent)
                        return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.fileChanged"));
                }

                var dir = Path.GetDirectoryName(file);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

                await System.IO.File.WriteAllTextAsync(file, content, cancellationToken);
                var fi = new FileInfo(file);
                return ApiResponse<WorkFileContentDto>.Ok(new WorkFileContentDto
                {
                    Path = relative, Name = fi.Name, Size = fi.Length, IsBinary = false, Content = content, ModifiedAt = fi.LastWriteTimeUtc
                });
            }

            // 远端：冲突校验 + base64 写入
            var quoted = SshCommandRunner.ShellQuote(RelativeToRemotePath(runner.RootPath, relative));
            if (request.OriginalContent != null)
            {
                var currentCmd = await runner.RunAsync($"test -f {quoted} && base64 < {quoted}", cancellationToken);
                if (currentCmd.ExitCode == 0)
                {
                    var current = Encoding.UTF8.GetString(Convert.FromBase64String(currentCmd.StdOut.Replace("\n", "").Replace("\r", "")));
                    if (current != request.OriginalContent)
                        return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.fileChanged"));
                }
            }

            var dirQuoted = SshCommandRunner.ShellQuote(RemoteDirOf(RelativeToRemotePath(runner.RootPath, relative)));
            var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(content));
            var writeResult = await runner.RunAsync(
                $"mkdir -p {dirQuoted} && base64 -d > {quoted}", stdin: b64, cancellationToken);
            if (writeResult.ExitCode != 0)
                return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.writeFileFailed", FirstLine(writeResult.StdErr) ?? _localizer.T("work.remoteCommandFailed")));

            var sizeCmd = await runner.RunAsync($"wc -c < {quoted}", cancellationToken);
            var size = long.TryParse(sizeCmd.StdOut.Trim(), out var sz2) ? sz2 : content.Length;
            return ApiResponse<WorkFileContentDto>.Ok(new WorkFileContentDto
            {
                Path = relative, Name = Path.GetFileName(relative), Size = size, IsBinary = false, Content = content,
            });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return ApiResponse<WorkFileContentDto>.Fail(_localizer.T("work.writeFileFailed", ex.Message));
        }
    }

    private async Task<IWorkCommandRunner?> ResolveRunnerAsync(Guid projectId, CancellationToken cancellationToken)
        => await ResolveRunnerAsync(projectId, null, cancellationToken);

    /// <summary>
    /// 解析项目命令执行器。<paramref name="sessionId"/> 命中带独立工作树的会话时改用工作树目录，
    /// 保证文件浏览器 / 编辑器与 Agent 操作的是同一份工作区。
    /// </summary>
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

    /// <summary>把仓库相对路径拼成远端绝对路径（本地项目 root 为盘符路径时远程以 / 为基）</summary>
    private static string RelativeToRemotePath(string root, string relative)
    {
        if (relative.Length == 0) return root;
        return root.EndsWith('/') ? root + relative : root + "/" + relative;
    }

    private static string RemoteDirOf(string remotePath)
    {
        var idx = remotePath.LastIndexOf('/');
        return idx <= 0 ? "/" : remotePath[..idx];
    }

    /// <summary>校验并规范化仓库内相对路径，越界返回 null</summary>
    private static string? NormalizeRelative(string root, string path)
    {
        var combined = Path.GetFullPath(Path.Combine(root, path ?? ""));
        var fullRoot = Path.GetFullPath(root);
        if (!combined.StartsWith(fullRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && combined != fullRoot)
            return null;
        return Path.GetRelativePath(fullRoot, combined).Replace('\\', '/');
    }

    private static string? FirstLine(string text) => text.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();

    private static IEnumerable<string> EnumerateProjectFiles(string root, CancellationToken cancellationToken)
    {
        var pending = new Stack<string>();
        pending.Push(root);

        while (pending.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var current = pending.Pop();

            string[] subDirs;
            string[] files;
            try
            {
                subDirs = Directory.GetDirectories(current);
                files = Directory.GetFiles(current);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            foreach (var file in files) yield return file;

            foreach (var sub in subDirs)
            {
                if (WorkProjectRules.IsBuiltinIgnoredDir(Path.GetFileName(sub))) continue;
                var relative = Path.GetRelativePath(root, sub).Replace('\\', '/');
                if (WorkProjectRules.IsIgnored(root, relative)) continue;
                pending.Push(sub);
            }
        }
    }
}
