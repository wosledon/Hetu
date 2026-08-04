using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
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

        var dir = ResolveSafePath(root, path ?? "");
        if (!Directory.Exists(dir)) return ApiResponse<List<WorkFileEntryDto>>.Fail("目录不存在");

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

        var file = ResolveSafePath(root, path);
        if (!System.IO.File.Exists(file)) return ApiResponse<WorkFileContentDto>.Fail("文件不存在");

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

    private async Task<string?> ResolveRootAsync(Guid projectId, CancellationToken cancellationToken)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null || string.IsNullOrWhiteSpace(project.RootPath)) return null;
        if (!Directory.Exists(project.RootPath)) return null;
        return Path.GetFullPath(project.RootPath);
    }

    /// <summary>将相对路径安全地解析到项目根目录内，防止目录穿越</summary>
    private static string ResolveSafePath(string root, string relative)
    {
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
            !full.Equals(root, StringComparison.OrdinalIgnoreCase))
        {
            return root;
        }
        return full;
    }
}
