using System.Reflection;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>系统能力：本地文件系统目录浏览（供前端目录选择器使用，不涉及原生对话框）。</summary>
[ApiController]
[Route("api/system")]
public class SystemController : ControllerBase
{
    private readonly ILocalizer _localizer;

    public SystemController(ILocalizer localizer)
    {
        _localizer = localizer;
    }

    /// <summary>当前后端程序集版本（与桌面壳 tauri.conf.json 同源维护，供「关于」页展示）</summary>
    [HttpGet("version")]
    public ApiResponse<VersionInfoDto> GetVersion()
    {
        var assembly = typeof(SystemController).Assembly;
        var informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        var version = informational?.Split('+')[0] ?? assembly.GetName().Version?.ToString() ?? "0.0.0";
        return ApiResponse<VersionInfoDto>.Ok(new VersionInfoDto { Version = version, ProductName = "Hetu" });
    }

    /// <summary>
    /// 列出指定路径下的子目录。path 为空时返回可用驱动器/根路径列表（current 也为空）。
    /// </summary>
    [HttpGet("fs/dirs")]
    public ApiResponse<FsDirsDto> ListDirs([FromQuery] string? path)
    {
        // 未指定路径：返回驱动器（Windows）或根目录（Unix）
        if (string.IsNullOrWhiteSpace(path))
        {
            List<FsEntryDto> roots = OperatingSystem.IsWindows()
                ? DriveInfo.GetDrives()
                    .Where(d => d.IsReady)
                    .Select(d => new FsEntryDto { Name = d.Name, Path = d.Name })
                    .ToList()
                : [new FsEntryDto { Name = "/", Path = "/" }];
            return ApiResponse<FsDirsDto>.Ok(new FsDirsDto { Current = string.Empty, Parent = null, Dirs = roots });
        }

        var full = Path.GetFullPath(path);
        if (!Directory.Exists(full))
            return ApiResponse<FsDirsDto>.Fail(_localizer.T("system.dirNotFound"));

        List<FsEntryDto> dirs;
        try
        {
            dirs = Directory.GetDirectories(full)
                .Select(d =>
                {
                    var info = new DirectoryInfo(d);
                    return new FsEntryDto { Name = info.Name, Path = info.FullName };
                })
                .OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (Exception e)
        {
            return ApiResponse<FsDirsDto>.Fail(_localizer.T("system.readDirFailed", e.Message));
        }

        DirectoryInfo? parent = null;
        try { parent = Directory.GetParent(full); } catch { /* 到达根目录时无父级 */ }

        return ApiResponse<FsDirsDto>.Ok(new FsDirsDto
        {
            Current = full,
            Parent = parent?.FullName,
            Dirs = dirs,
        });
    }
}

public class FsDirsDto
{
    public string Current { get; set; } = string.Empty;
    public string? Parent { get; set; }
    public List<FsEntryDto> Dirs { get; set; } = [];
}

public class FsEntryDto
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
}

public class VersionInfoDto
{
    public string Version { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
}
