using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Work;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 目录浏览能力：本地目录列举、本机 SSH 配置读取、远程目录列举。
/// 让新建项目时目录可以"选"而不是只能手填，SSH 连接参数可直接从本机配置导入。
/// </summary>
[ApiController]
[Route("api/work")]
public class WorkBrowseController : ControllerBase
{
    private readonly IDataProtectionProvider _dataProtection;
    private readonly ILogger<WorkBrowseController> _logger;
    private readonly ILocalizer _localizer;

    public WorkBrowseController(IDataProtectionProvider dataProtection, ILogger<WorkBrowseController> logger, ILocalizer localizer)
    {
        _dataProtection = dataProtection;
        _logger = logger;
        _localizer = localizer;
    }

    /// <summary>
    /// 列举本地目录。path 为空时返回盘符（Windows）或用户主目录（Unix）。
    /// </summary>
    [HttpGet("local/dirs")]
    public ApiResponse<DirListingDto> ListLocalDirs([FromQuery] string? path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                var roots = OperatingSystem.IsWindows()
                    ? DriveInfo.GetDrives()
                        .Where(d => d.IsReady)
                        .Select(d => d.Name)
                        .ToList()
                    : new List<string> { "/" };
                return ApiResponse<DirListingDto>.Ok(new DirListingDto
                {
                    Current = string.Empty,
                    Parent = null,
                    Entries = roots.Select(r => new DirEntryDto(r, true)).ToList(),
                });
            }

            var full = Path.GetFullPath(path);
            if (!Directory.Exists(full))
                return ApiResponse<DirListingDto>.Fail(_localizer.T("work.dirNotFound"));

            var dirs = Directory.GetDirectories(full)
                .Select(d =>
                {
                    try { return new DirectoryInfo(d); }
                    catch { return null; }
                })
                .Where(d => d != null && (d.Attributes & FileAttributes.Hidden) == 0)
                .OrderBy(d => d!.Name, StringComparer.OrdinalIgnoreCase)
                .Select(d => new DirEntryDto(d!.Name, true))
                .ToList();

            return ApiResponse<DirListingDto>.Ok(new DirListingDto
            {
                Current = full,
                Parent = Directory.GetParent(full)?.FullName,
                Entries = dirs,
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[WorkBrowse] 列举本地目录失败 path={Path}", path);
            return ApiResponse<DirListingDto>.Fail(_localizer.T("work.readLocalDirFailed", ex.Message));
        }
    }

    /// <summary>读取本机 SSH 配置（~/.ssh/config，含 Include），避免重复填写连接参数</summary>
    [HttpGet("ssh/hosts")]
    public ApiResponse<List<SshConfigHostDto>> ListSshConfigHosts()
    {
        try
        {
            var configPath = GetDefaultSshConfigPath();
            if (configPath == null || !System.IO.File.Exists(configPath))
                return ApiResponse<List<SshConfigHostDto>>.Ok(new List<SshConfigHostDto>());

            var hosts = new List<SshConfigHostDto>();
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            ParseSshConfig(configPath, hosts, visited, depth: 0);
            return ApiResponse<List<SshConfigHostDto>>.Ok(hosts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[WorkBrowse] 读取 SSH 配置失败");
            return ApiResponse<List<SshConfigHostDto>>.Fail(_localizer.T("work.readSshConfigFailed", ex.Message));
        }
    }

    /// <summary>列举远程目录（需要连接参数已填写，用于选择远程项目目录）</summary>
    [HttpPost("ssh/dirs")]
    public async Task<ApiResponse<DirListingDto>> ListRemoteDirs([FromBody] WorkSshBrowseRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Host))
            return ApiResponse<DirListingDto>.Fail(_localizer.T("work.hostRequired"));

        var path = string.IsNullOrWhiteSpace(request.Path) ? "~" : request.Path.Trim();
        var project = new WorkProject
        {
            Id = Guid.NewGuid(),
            Name = "ssh-browse",
            RootPath = path,
            ConnectionType = "Ssh",
            SshHost = request.Host.Trim(),
            SshPort = request.Port <= 0 ? 22 : request.Port,
            SshUser = request.User,
            SshAuthType = string.IsNullOrWhiteSpace(request.AuthType) ? "Key" : request.AuthType!,
            SshKeyPath = request.KeyPath,
            SshPasswordProtected = string.IsNullOrEmpty(request.Password) ? null : Protect(request.Password),
        };

        string? Decrypt(string v) =>
            string.IsNullOrEmpty(v) ? null : System.Text.Encoding.UTF8.GetString(_dataProtection.CreateProtector("Hetu.Ssh").Unprotect(Convert.FromBase64String(v)));

        var runner = new SshCommandRunner(project, Decrypt);
        try
        {
            // pwd -P 输出规范化后的绝对路径；ls -1p 目录带 / 后缀
            var result = await runner.RunAsync("pwd -P && ls -1p", cancellationToken);
            if (result.ExitCode != 0)
                return ApiResponse<DirListingDto>.Fail(_localizer.T("work.readRemoteDirFailed", FirstLine(result.StdErr) ?? _localizer.T("work.unknownError")));

            var lines = result.StdOut.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length == 0)
                return ApiResponse<DirListingDto>.Fail(_localizer.T("work.remoteDirParseFailed"));

            var current = lines[0].Trim();
            var entries = new List<DirEntryDto>();
            foreach (var raw in lines.Skip(1))
            {
                var name = raw.TrimEnd('\r').Trim();
                if (string.IsNullOrEmpty(name) || name is "." or "..") continue;

                var isDir = name.EndsWith('/');
                var cleanName = isDir ? name.TrimEnd('/') : name;
                if (string.IsNullOrEmpty(cleanName)) continue;
                entries.Add(new DirEntryDto(cleanName, isDir));
            }

            return ApiResponse<DirListingDto>.Ok(new DirListingDto
            {
                Current = current,
                Parent = ParentOf(current),
                Entries = entries.OrderByDescending(e => e.IsDirectory).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase).ToList(),
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[WorkBrowse] 列举远程目录失败 host={Host}", request.Host);
            return ApiResponse<DirListingDto>.Fail(_localizer.T("work.readRemoteDirFailed", ex.Message));
        }
    }

    private static string? ParentOf(string path)
    {
        if (string.IsNullOrEmpty(path) || path == "/") return null;
        var idx = path.LastIndexOf('/');
        if (idx <= 0) return "/";
        return path[..idx];
    }

    private string Protect(string password)
        => Convert.ToBase64String(_dataProtection.CreateProtector("Hetu.Ssh").Protect(System.Text.Encoding.UTF8.GetBytes(password)));

    private static string? FirstLine(string text) => text.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();

    private static string? GetDefaultSshConfigPath()
    {
        var home = Environment.GetEnvironmentVariable("HOME")
            ?? Environment.GetEnvironmentVariable("USERPROFILE");
        if (string.IsNullOrWhiteSpace(home)) return null;
        return Path.Combine(home, ".ssh", "config");
    }

    /// <summary>解析 ssh_config：Host 块（忽略通配符）+ Include 展开，~ 前缀展开为主机路径</summary>
    private void ParseSshConfig(string configPath, List<SshConfigHostDto> hosts, HashSet<string> visited, int depth)
    {
        if (depth > 4 || !visited.Add(configPath)) return;

        string[] lines;
        try { lines = System.IO.File.ReadAllLines(configPath); }
        catch (Exception ex)
        {
            _logger.LogDebug("[WorkBrowse] 跳过无法读取的 SSH 配置 {Path}: {Message}", configPath, ex.Message);
            return;
        }

        var baseDir = Path.GetDirectoryName(Path.GetFullPath(configPath)) ?? ".";
        var home = Environment.GetEnvironmentVariable("HOME") ?? Environment.GetEnvironmentVariable("USERPROFILE");

        SshConfigHostDto? current = null;
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;

            var sep = line.IndexOfAny(new[] { ' ', '=', '\t' });
            if (sep <= 0) continue;
            var key = line[..sep].Trim();
            var value = line[(sep + 1)..].Trim().Trim('"');

            if (key.Equals("Host", StringComparison.OrdinalIgnoreCase))
            {
                current = null;
                var aliases = value.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                foreach (var alias in aliases)
                {
                    if (alias.Contains('*') || alias.Contains('?') || alias.Contains('!')) continue;
                    if (hosts.Any(h => h.Alias.Equals(alias, StringComparison.OrdinalIgnoreCase))) continue;
                    current = new SshConfigHostDto { Alias = alias };
                    hosts.Add(current);
                }
                continue;
            }

            if (key.Equals("Include", StringComparison.OrdinalIgnoreCase) && value.Length > 0)
            {
                var pattern = value.Replace("~", home ?? string.Empty);
                if (!Path.IsPathRooted(pattern)) pattern = Path.Combine(baseDir, pattern);
                foreach (var included in GlobFiles(pattern))
                    ParseSshConfig(included, hosts, visited, depth + 1);
                continue;
            }

            if (current == null) continue;

            if (key.Equals("HostName", StringComparison.OrdinalIgnoreCase)) current.HostName = value;
            else if (key.Equals("User", StringComparison.OrdinalIgnoreCase)) current.User = value;
            else if (key.Equals("Port", StringComparison.OrdinalIgnoreCase) && int.TryParse(value, out var p)) current.Port = p;
            else if (key.Equals("IdentityFile", StringComparison.OrdinalIgnoreCase)) current.IdentityFile = ExpandHome(value);
        }
    }

    private static string ExpandHome(string value)
    {
        var home = Environment.GetEnvironmentVariable("HOME") ?? Environment.GetEnvironmentVariable("USERPROFILE");
        if (!string.IsNullOrEmpty(home) && value.StartsWith("~/"))
            return Path.Combine(home, value[2..]);
        if (!string.IsNullOrEmpty(home) && value == "~")
            return home;
        return value;
    }

    /// <summary>简易 glob：展开包含 * / ? 的 Include 路径</summary>
    private static IEnumerable<string> GlobFiles(string pattern)
    {
        try
        {
            var full = Path.GetFullPath(pattern);
            var dir = Path.GetDirectoryName(full) ?? ".";
            var name = Path.GetFileName(full);
            if (name.IndexOfAny(new[] { '*', '?' }) < 0)
            {
                return System.IO.File.Exists(full) ? new[] { full } : Array.Empty<string>();
            }
            if (!Directory.Exists(dir)) return Array.Empty<string>();
            return Directory.GetFiles(dir, name);
        }
        catch
        {
            return Array.Empty<string>();
        }
    }
}

public class WorkSshBrowseRequest
{
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 22;
    public string? User { get; set; }
    public string? AuthType { get; set; }
    public string? KeyPath { get; set; }
    public string? Password { get; set; }
    public string? Path { get; set; }
}

public class DirEntryDto
{
    public DirEntryDto(string name, bool isDirectory)
    {
        Name = name;
        IsDirectory = isDirectory;
    }

    public string Name { get; set; }
    public bool IsDirectory { get; set; }
}

public class DirListingDto
{
    public string Current { get; set; } = string.Empty;
    public string? Parent { get; set; }
    public List<DirEntryDto> Entries { get; set; } = new();
}

public class SshConfigHostDto
{
    public string Alias { get; set; } = string.Empty;
    public string? HostName { get; set; }
    public string? User { get; set; }
    public int Port { get; set; } = 22;
    public string? IdentityFile { get; set; }
}
