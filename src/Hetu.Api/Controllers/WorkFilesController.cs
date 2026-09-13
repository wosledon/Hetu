using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>工作项目文件系统浏览（限制在项目根目录内）</summary>
[ApiController]
[Route("api/work-projects/{projectId:guid}/fs")]
public class WorkFilesController : ControllerBase
{
    private readonly IUnitOfWork _unitOfWork;

    public WorkFilesController(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    [HttpGet("list")]
    public async Task<ApiResponse<List<WorkFileEntryDto>>> List(Guid projectId, [FromQuery] string? path, CancellationToken cancellationToken)
    {
        var root = await ResolveRootAsync(projectId, cancellationToken);
        if (root == null) return ApiResponse<List<WorkFileEntryDto>>.Fail("项目不存在");

        var dir = WorkPath.Resolve(root, path ?? "");
        if (dir == null || !Directory.Exists(dir)) return ApiResponse<List<WorkFileEntryDto>>.Fail("目录不存在");

        try
        {
            var entries = new List<WorkFileEntryDto>();
            foreach (var d in Directory.GetDirectories(dir))
            {
                var di = new DirectoryInfo(d);
                entries.Add(new WorkFileEntryDto
                {
                    Name = di.Name,
                    Path = Path.GetRelativePath(root, di.FullName).Replace('\\', '/'),
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
                    Path = Path.GetRelativePath(root, fi.FullName).Replace('\\', '/'),
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
        catch (Exception ex)
        {
            return ApiResponse<List<WorkFileEntryDto>>.Fail($"读取目录失败: {ex.Message}");
        }
    }

    [HttpGet("read")]
    public async Task<ApiResponse<WorkFileContentDto>> Read(Guid projectId, [FromQuery] string path, CancellationToken cancellationToken)
    {
        var root = await ResolveRootAsync(projectId, cancellationToken);
        if (root == null) return ApiResponse<WorkFileContentDto>.Fail("项目不存在");

        var file = WorkPath.Resolve(root, path);
        if (file == null || !System.IO.File.Exists(file)) return ApiResponse<WorkFileContentDto>.Fail("文件不存在");

        try
        {
            var fi = new FileInfo(file);
            // 二进制/大文件不读取内容
            var ext = fi.Extension.ToLowerInvariant();
            var binaryExts = new HashSet<string> { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".dll", ".exe", ".zip", ".7z", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".eot", ".db", ".sqlite", ".node", ".map" };
            var isBinary = binaryExts.Contains(ext) || fi.Length > 2 * 1024 * 1024;
            string? content = null;
            if (!isBinary)
            {
                content = await System.IO.File.ReadAllTextAsync(file, cancellationToken);
            }
            return ApiResponse<WorkFileContentDto>.Ok(new WorkFileContentDto
            {
                Path = Path.GetRelativePath(root, file).Replace('\\', '/'),
                Name = fi.Name,
                Size = fi.Length,
                IsBinary = isBinary,
                Content = content,
                ModifiedAt = fi.LastWriteTimeUtc
            });
        }
        catch (Exception ex)
        {
            return ApiResponse<WorkFileContentDto>.Fail($"读取文件失败: {ex.Message}");
        }
    }

    /// <summary>项目内文件名/内容搜索（遵守 .gitignore/.hetuignore 与内置忽略目录）</summary>
    [HttpGet("search")]
    public async Task<ApiResponse<List<WorkFileSearchHitDto>>> Search(
        Guid projectId,
        [FromQuery] string query,
        [FromQuery] int limit,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query)) return ApiResponse<List<WorkFileSearchHitDto>>.Ok([]);

        var root = await ResolveRootAsync(projectId, cancellationToken);
        if (root == null) return ApiResponse<List<WorkFileSearchHitDto>>.Fail("项目不存在");

        var max = Math.Clamp(limit <= 0 ? 60 : limit, 1, 200);
        var needle = query.Trim();
        var hits = new List<WorkFileSearchHitDto>();
        var scanned = 0;

        // 先按文件名匹配，保证定位类搜索优先生效
        foreach (var file in EnumerateProjectFiles(root, cancellationToken))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (++scanned > 20000 || hits.Count >= max) break;

            var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
            if (relative.Contains(needle, StringComparison.OrdinalIgnoreCase))
                hits.Add(new WorkFileSearchHitDto { Path = relative, Line = 0, Text = Path.GetFileName(file) });
        }

        if (hits.Count < max)
        {
            var remaining = max - hits.Count;
            foreach (var file in EnumerateProjectFiles(root, cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (remaining <= 0) break;
                if (!WorkProjectRules.IsProbablyText(file)) continue;

                string[] lines;
                try
                {
                    lines = await System.IO.File.ReadAllLinesAsync(file, cancellationToken);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    continue;
                }

                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
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

    private async Task<string?> ResolveRootAsync(Guid projectId, CancellationToken cancellationToken)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null || string.IsNullOrWhiteSpace(project.RootPath)) return null;
        if (!Directory.Exists(project.RootPath)) return null;
        return Path.GetFullPath(project.RootPath);
    }
}
