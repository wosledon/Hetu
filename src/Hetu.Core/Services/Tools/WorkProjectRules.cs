using System.Collections.Concurrent;
using System.Text;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 项目忽略规则与规则文件：与 Work 工具（列表/搜索/遍历）共用，
/// 内置忽略目录 + .gitignore / .hetuignore。
/// </summary>
public static class WorkProjectRules
{
    /// <summary>内置忽略的目录名（大小写不敏感）</summary>
    private static readonly HashSet<string> BuiltinDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".svn", ".hg", ".vs", ".idea", ".vscode-test",
        "node_modules", "bower_components", "vendor",
        "bin", "obj", "dist", "build", "out", "target", "coverage",
        ".next", ".nuxt", ".turbo", ".cache", ".parcel-cache",
        "venv", ".venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        ".gradle", ".mvn", "packages", "TestResults", "artifacts",
    };

    private const int MaxRuleFileChars = 6000;
    private const long MaxScannedFileBytes = 1024 * 1024;

    private sealed record IgnoreSnapshot(DateTime IgnoreMtime, DateTime HetuMtime, IReadOnlyList<string> Patterns);

    private static readonly ConcurrentDictionary<string, IgnoreSnapshot> IgnoreCache = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>是否为内置忽略目录</summary>
    public static bool IsBuiltinIgnoredDir(string name) => BuiltinDirs.Contains(name);

    /// <summary>判断相对路径是否应被忽略</summary>
    public static bool IsIgnored(string root, string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrEmpty(normalized)) return false;

        foreach (var segment in normalized.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (BuiltinDirs.Contains(segment)) return true;
        }

        var ignored = false;
        foreach (var pattern in LoadIgnorePatterns(root))
        {
            var negate = pattern.StartsWith('!');
            var body = negate ? pattern[1..] : pattern;
            if (body.Length == 0) continue;

            var directoryOnly = body.EndsWith('/');
            if (directoryOnly) body = body.TrimEnd('/');

            var matched = body.Contains('/')
                ? WorkToolPolicy.GlobMatch(body, normalized) ||
                  (!directoryOnly && WorkToolPolicy.GlobMatch(body + "/**", normalized))
                : WorkToolPolicy.GlobMatch("**/" + body, normalized) ||
                  WorkToolPolicy.GlobMatch("**/" + body + "/**", normalized);

            if (matched) ignored = !negate;
        }

        return ignored;
    }

    /// <summary>读取 .gitignore / .hetuignore 的合并规则（按文件 mtime 缓存）</summary>
    public static IReadOnlyList<string> LoadIgnorePatterns(string root)
    {
        if (string.IsNullOrWhiteSpace(root)) return [];

        try
        {
            var gitIgnore = Path.Combine(root, ".gitignore");
            var hetuIgnore = Path.Combine(root, ".hetuignore");
            var gitMtime = File.Exists(gitIgnore) ? File.GetLastWriteTimeUtc(gitIgnore) : DateTime.MinValue;
            var hetuMtime = File.Exists(hetuIgnore) ? File.GetLastWriteTimeUtc(hetuIgnore) : DateTime.MinValue;

            if (IgnoreCache.TryGetValue(root, out var cached) &&
                cached.IgnoreMtime == gitMtime && cached.HetuMtime == hetuMtime)
            {
                return cached.Patterns;
            }

            var patterns = new List<string>();
            AppendPatterns(gitIgnore, patterns);
            AppendPatterns(hetuIgnore, patterns);

            var snapshot = new IgnoreSnapshot(gitMtime, hetuMtime, patterns);
            IgnoreCache[root] = snapshot;
            return patterns;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private static void AppendPatterns(string file, List<string> patterns)
    {
        if (!File.Exists(file)) return;
        foreach (var raw in File.ReadLines(file))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            patterns.Add(line);
        }
    }

    /// <summary>判断文件是否可安全作为文本读取（扩展名黑名单 + 体积上限 + NUL 探测）</summary>
    public static bool IsProbablyText(string fullPath)
    {
        var ext = Path.GetExtension(fullPath).ToLowerInvariant();
        if (BinaryExtensions.Contains(ext)) return false;

        try
        {
            var info = new FileInfo(fullPath);
            if (!info.Exists || info.Length == 0) return true;
            if (info.Length > MaxScannedFileBytes) return false;

            using var stream = File.OpenRead(fullPath);
            var buffer = new byte[Math.Min(4096, (int)info.Length)];
            var read = stream.Read(buffer, 0, buffer.Length);
            return Array.IndexOf(buffer, (byte)0, 0, read) < 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static readonly HashSet<string> BinaryExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff", ".svgz",
        ".pdf", ".dll", ".exe", ".so", ".dylib", ".pdb", ".obj", ".class", ".jar", ".wasm",
        ".zip", ".7z", ".gz", ".tar", ".rar", ".bz2", ".xz",
        ".woff", ".woff2", ".ttf", ".eot", ".otf",
        ".db", ".sqlite", ".sqlite3", ".mdb", ".node", ".map",
        ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg",
    };

    /// <summary>
    /// 读取项目规则文件（AGENTS.md / HETU.md / .cursorrules / .hetu/rules.md /
    /// .github/copilot-instructions.md），拼成注入 system prompt 的上下文。
    /// </summary>
    public static string LoadRuleContext(string root, int maxChars = MaxRuleFileChars)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return string.Empty;

        var candidates = new[]
        {
            "AGENTS.md", "HETU.md", ".hetu/rules.md", ".cursorrules", ".github/copilot-instructions.md"
        };

        var sb = new StringBuilder();
        foreach (var relative in candidates)
        {
            var full = WorkPath.Resolve(root, relative);
            if (full == null || !File.Exists(full)) continue;
            try
            {
                var text = File.ReadAllText(full).Trim();
                if (text.Length == 0) continue;
                if (sb.Length + text.Length > maxChars)
                    text = text[..Math.Max(0, maxChars - sb.Length)] + "\n…（内容过长已截断）";
                sb.AppendLine($"### {relative}");
                sb.AppendLine(text);
                sb.AppendLine();
                if (sb.Length >= maxChars) break;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // 单个规则文件不可读不影响其余上下文
            }
        }

        return sb.ToString().Trim();
    }

    /// <summary>
    /// 采集 git 上下文（当前分支 + 工作区状态摘要），供 system prompt 使用。
    /// 非 git 仓库或 git 不可用时返回空串。
    /// </summary>
    public static async Task<string> BuildGitContextAsync(string root, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return string.Empty;

        var branch = await RunGitAsync(root, "rev-parse --abbrev-ref HEAD", cancellationToken);
        if (string.IsNullOrWhiteSpace(branch)) return string.Empty;

        var status = await RunGitAsync(root, "status --porcelain", cancellationToken);
        var lines = (status ?? string.Empty)
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.TrimEnd('\r'))
            .ToList();

        var summary = lines.Count == 0
            ? "工作区干净"
            : $"共 {lines.Count} 项未提交变更：\n" + string.Join('\n', lines.Take(20)) +
              (lines.Count > 20 ? $"\n…（其余 {lines.Count - 20} 项省略）" : string.Empty);

        return $"当前分支: {branch.Trim()}\n工作区状态: {summary}";
    }

    private static async Task<string?> RunGitAsync(string root, string arguments, CancellationToken cancellationToken)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "git",
                Arguments = arguments,
                WorkingDirectory = root,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var process = System.Diagnostics.Process.Start(psi);
            if (process == null) return null;

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(5));
            var output = await process.StandardOutput.ReadToEndAsync(cts.Token);
            await process.WaitForExitAsync(cts.Token);
            return process.ExitCode == 0 ? output : null;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or OperationCanceledException or IOException)
        {
            return null;
        }
    }
}
