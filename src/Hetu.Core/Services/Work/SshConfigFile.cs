namespace Hetu.Core.Services.Work;

/// <summary>
/// 本机 ~/.ssh/config 的解析：Host 块（忽略通配符）+ Include 展开，~ 前缀展开为用户主目录。
/// 供「从 SSH 配置导入」表单与「SSH 项目登录用户为空时按配置补全」共用一份实现。
/// </summary>
public static class SshConfigFile
{
    public sealed class Host
    {
        public string Alias { get; set; } = string.Empty;
        public string? HostName { get; set; }
        public string? User { get; set; }
        public int Port { get; set; } = 22;
        public string? IdentityFile { get; set; }
    }

    /// <summary>默认配置路径（~/.ssh/config）：Unix 看 HOME，Windows 看 USERPROFILE</summary>
    public static string? DefaultPath()
    {
        var home = Environment.GetEnvironmentVariable("HOME")
            ?? Environment.GetEnvironmentVariable("USERPROFILE");
        return string.IsNullOrWhiteSpace(home) ? null : Path.Combine(home, ".ssh", "config");
    }

    /// <summary>解析配置；文件不存在或读取失败时返回空列表（不抛异常）</summary>
    public static List<Host> Load(string? configPath = null)
    {
        var path = configPath ?? DefaultPath();
        if (path == null || !File.Exists(path)) return new List<Host>();

        var hosts = new List<Host>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Parse(path, hosts, visited, depth: 0);
        return hosts;
    }

    /// <summary>
    /// 按主机地址补全登录用户：先按 HostName 精确匹配（项目里常存解析后的 IP，如 192.168.1.4），
    /// 再按别名匹配（项目里存的是别名时 ssh 自己也会解析，这里一并补全入库）。
    /// 没有匹配、匹配块没有 User 时返回 null（保持 ssh 的默认行为）。
    /// </summary>
    public static string? ResolveUser(string? host, string? configPath = null)
    {
        if (string.IsNullOrWhiteSpace(host)) return null;
        var target = host.Trim();
        var hosts = Load(configPath);
        var match = hosts.FirstOrDefault(h => !string.IsNullOrWhiteSpace(h.HostName)
                && string.Equals(h.HostName, target, StringComparison.OrdinalIgnoreCase))
            ?? hosts.FirstOrDefault(h => string.Equals(h.Alias, target, StringComparison.OrdinalIgnoreCase));
        return string.IsNullOrWhiteSpace(match?.User) ? null : match!.User;
    }

    private static void Parse(string configPath, List<Host> hosts, HashSet<string> visited, int depth)
    {
        if (depth > 4 || !visited.Add(configPath)) return;

        string[] lines;
        try { lines = File.ReadAllLines(configPath); }
        catch { return; }

        var baseDir = Path.GetDirectoryName(Path.GetFullPath(configPath)) ?? ".";
        var home = Environment.GetEnvironmentVariable("HOME") ?? Environment.GetEnvironmentVariable("USERPROFILE");

        Host? current = null;
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
                    current = new Host { Alias = alias };
                    hosts.Add(current);
                }
                continue;
            }

            if (key.Equals("Include", StringComparison.OrdinalIgnoreCase) && value.Length > 0)
            {
                var pattern = value.Replace("~", home ?? string.Empty);
                if (!Path.IsPathRooted(pattern)) pattern = Path.Combine(baseDir, pattern);
                foreach (var included in GlobFiles(pattern))
                    Parse(included, hosts, visited, depth + 1);
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
                return File.Exists(full) ? new[] { full } : Array.Empty<string>();
            if (!Directory.Exists(dir)) return Array.Empty<string>();
            return Directory.GetFiles(dir, name);
        }
        catch
        {
            return Array.Empty<string>();
        }
    }
}
