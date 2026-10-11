using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using Hetu.Core.Interfaces;
using Hetu.Shared.Work;

namespace Hetu.Api.Services;

/// <summary>
/// 用外部应用打开项目目录（VS Code / Cursor / 文件资源管理器 / 终端）。
/// 桌面 Agent 场景的一键跳转：探测已安装应用、提取应用图标（缓存 PNG）、解析绝对路径直接启动。
/// </summary>
public class WorkOpenInAppService
{
    private static readonly string[] AllApps = ["vscode", "cursor", "explorer", "terminal"];

    private static readonly Dictionary<string, string> AppLabels = new()
    {
        ["vscode"] = "VS Code",
        ["cursor"] = "Cursor",
        ["explorer"] = "文件资源管理器",
        ["terminal"] = "终端",
    };

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly string _iconCacheDir;

    public WorkOpenInAppService(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
        _iconCacheDir = Path.Combine(Path.GetTempPath(), "hetu-open-icons");
    }

    /// <summary>已安装的应用列表（含图标地址），未安装的不返回</summary>
    public List<WorkOpenAppDto> GetApps()
    {
        var result = new List<WorkOpenAppDto>();
        foreach (var app in AllApps)
        {
            if (ResolveIconSource(app) == null) continue; // 未安装 → 不展示
            result.Add(new WorkOpenAppDto
            {
                App = app,
                Label = AppLabels[app],
                Available = true,
                IconUrl = $"/api/work-open/icon?app={app}",
            });
        }
        return result;
    }

    /// <summary>应用图标 PNG（首次提取后缓存到临时目录）</summary>
    public byte[]? GetIcon(string app)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(6, 1)) return null;
        if (!AllApps.Contains(app)) return null;
        var iconExe = ResolveIconSource(app);
        if (iconExe == null) return null;

        var cacheFile = Path.Combine(_iconCacheDir, $"{app}.png");
        try
        {
            if (File.Exists(cacheFile)) return File.ReadAllBytes(cacheFile);
            Directory.CreateDirectory(_iconCacheDir);
            using var icon = Icon.ExtractAssociatedIcon(iconExe);
            if (icon == null) return null;
            using var bitmap = icon.ToBitmap();
            using var ms = new MemoryStream();
            bitmap.Save(ms, ImageFormat.Png);
            var bytes = ms.ToArray();
            File.WriteAllBytes(cacheFile, bytes);
            return bytes;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or System.Runtime.InteropServices.ExternalException)
        {
            return null;
        }
    }

    public async Task<(bool Success, string Output)> OpenAsync(Guid projectId, string app, CancellationToken cancellationToken = default)
    {
        string? root;
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
            var project = await unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
            if (project == null || string.IsNullOrWhiteSpace(project.RootPath) || !Directory.Exists(project.RootPath))
                return (false, "项目目录不存在");
            root = project.RootPath;
        }

        var exe = ResolveExecutable(app);
        if (exe == null)
            return (false, $"未检测到{AppLabels.GetValueOrDefault(app, app)}，可能尚未安装");

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                UseShellExecute = true,
                CreateNoWindow = true,
            };
            // VS Code / Cursor / 资源管理器直接带目录参数；终端用 -d 指定工作目录
            if (OperatingSystem.IsWindows() && app == "terminal")
            {
                psi.ArgumentList.Add("-d");
                psi.ArgumentList.Add(root);
            }
            else
            {
                psi.ArgumentList.Add(root);
            }

            using var process = Process.Start(psi);
            return process != null
                ? (true, $"已用{AppLabels.GetValueOrDefault(app, app)}打开")
                : (false, "启动进程失败");
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            return (false, $"打开失败：{ex.Message}");
        }
    }

    /// <summary>图标来源：操作系统的程序本体。非 Windows 或未安装时返回 null。</summary>
    private static string? ResolveIconSource(string app)
    {
        if (!OperatingSystem.IsWindows()) return null;
        return app switch
        {
            "vscode" => FirstExisting(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft VS Code", "Code.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Microsoft VS Code", "Code.exe")),
            "cursor" => FirstExisting(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "cursor", "Cursor.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Cursor", "Cursor.exe")),
            "explorer" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"),
            "terminal" => FirstExisting(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "wt.exe")),
            _ => null,
        };
    }

    /// <summary>启动用的可执行文件：与图标来源一致；终端缺失时回落到 PowerShell</summary>
    private static string? ResolveExecutable(string app)
    {
        if (!OperatingSystem.IsWindows()) return null;
        if (app == "terminal")
        {
            var wt = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "wt.exe");
            return File.Exists(wt)
                ? wt
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        }
        return ResolveIconSource(app);
    }

    private static string? FirstExisting(params string?[] paths)
    {
        foreach (var p in paths)
        {
            if (!string.IsNullOrWhiteSpace(p) && File.Exists(p)) return p;
        }
        return null;
    }
}
