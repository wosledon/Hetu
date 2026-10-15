using System.Collections.Concurrent;
using System.Text;
using Hetu.Core.Services.Work;

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

        return IsIgnored(LoadIgnorePatterns(root), normalized);
    }

    /// <summary>
    /// 按显式规则列表判断相对路径是否应被忽略（不含内置目录判断之外的根目录逻辑）。
    /// 供远端项目使用：规则内容通过 shell 读取后传入，复用同一套匹配语义。
    /// </summary>
    public static bool IsIgnored(IReadOnlyList<string> patterns, string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrEmpty(normalized)) return false;

        foreach (var segment in normalized.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (BuiltinDirs.Contains(segment)) return true;
        }

        var ignored = false;
        foreach (var pattern in patterns)
        {
            var negate = pattern.StartsWith('!');
            var body = negate ? pattern[1..] : pattern;
            if (body.Length == 0) continue;

            var directoryOnly = body.EndsWith('/');
            if (directoryOnly) body = body.TrimEnd('/');

            var matched = body.AsSpan().IndexOfAny('*', '?') >= 0
                ? MatchGlob(body, normalized, directoryOnly)
                // 无通配符的字面量规则走字符串比较：gitignore 绝大多数行是字面量，
                // 走正则等于「每文件 × 每条规则」都要编译+IsMatch，扫描大目录时是主要耗时
                : MatchLiteral(body, normalized, directoryOnly);

            if (matched) ignored = !negate;
        }

        return ignored;
    }

    private static bool MatchGlob(string body, string path, bool directoryOnly)
        => body.Contains('/')
            ? WorkToolPolicy.GlobMatch(body, path) ||
              (!directoryOnly && WorkToolPolicy.GlobMatch(body + "/**", path))
            : WorkToolPolicy.GlobMatch("**/" + body, path) ||
              WorkToolPolicy.GlobMatch("**/" + body + "/**", path);

    /// <summary>
    /// 字面量规则的等价匹配（与 MatchGlob 的两条展开式同语义，仅跳过正则）：
    /// 含 '/' → 精确路径或其子路径（子路径仅非 directoryOnly 时）；
    /// 不含 '/' → 任意层级同名，或任意层级同名目录的子路径（与原实现一致，不受 directoryOnly 约束）。
    /// </summary>
    private static bool MatchLiteral(string body, string path, bool directoryOnly)
    {
        if (body.Contains('/'))
            return path.Equals(body, StringComparison.OrdinalIgnoreCase) ||
                   (!directoryOnly && path.StartsWith(body + "/", StringComparison.OrdinalIgnoreCase));

        return path.Equals(body, StringComparison.OrdinalIgnoreCase) ||
               path.EndsWith("/" + body, StringComparison.OrdinalIgnoreCase) ||
               path.StartsWith(body + "/", StringComparison.OrdinalIgnoreCase) ||
               path.Contains("/" + body + "/", StringComparison.OrdinalIgnoreCase);
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
    public static bool IsProbablyText(string fullPath) => IsProbablyText(fullPath, MaxScannedFileBytes);

    /// <summary>同 <see cref="IsProbablyText(string)"/>，但可指定体积上限（如检查点差异允许更大的文本文件）</summary>
    public static bool IsProbablyText(string fullPath, long maxBytes)
    {
        var ext = Path.GetExtension(fullPath).ToLowerInvariant();
        if (BinaryExtensions.Contains(ext)) return false;

        try
        {
            var info = new FileInfo(fullPath);
            if (!info.Exists || info.Length == 0) return true;
            if (info.Length > maxBytes) return false;

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
    /// 读取项目规则文件（AGENTS.md / HETU.md / .hetu/rules.md / .cursorrules），
    /// 拼成注入 system prompt 的上下文。
    /// .github 目录下的 Copilot 指令/智能体/提示词由 <see cref="WorkCopilotAssets"/> 单独加载，不在此处重复。
    /// </summary>
    public static string LoadRuleContext(string root, int maxChars = MaxRuleFileChars)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return string.Empty;

        var candidates = new[]
        {
            "AGENTS.md", "HETU.md", ".hetu/rules.md", ".cursorrules"
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

    /// <summary>
    /// PR 摘要缓存：每个目录 45 秒内只查一次（system prompt 每轮都要拼，gh 调用不该拖慢对话）。
    /// </summary>
    private static readonly ConcurrentDictionary<string, (DateTimeOffset At, string? Text)> PrSummaryCache =
        new(StringComparer.OrdinalIgnoreCase);

    private static readonly TimeSpan PrSummaryTtl = TimeSpan.FromSeconds(45);

    /// <summary>
    /// 采集当前分支的 PR / MR 摘要（编号、状态、变更量、门禁、审查结论），让会话「感知」PR 状态。
    /// 非 git 仓库、远端不支持或 gh / glab 不可用时返回空串，不影响主流程。
    /// </summary>
    public static async Task<string> BuildPrContextAsync(string root, IWorkCommandRunner? runner, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(root)) return string.Empty;
        var commandRunner = runner
            ?? (Directory.Exists(root) ? new LocalCommandRunner(root) : null);
        if (commandRunner == null) return string.Empty;

        if (PrSummaryCache.TryGetValue(commandRunner.RootPath, out var cached)
            && DateTimeOffset.UtcNow - cached.At < PrSummaryTtl)
        {
            return cached.Text ?? string.Empty;
        }

        string? text;
        try
        {
            text = await WorkPrClient.ForRunner(commandRunner).GetSummaryAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 查询失败不该拖垮一轮对话：按「没有 PR 信息」继续
            text = null;
        }

        PrSummaryCache[commandRunner.RootPath] = (DateTimeOffset.UtcNow, text);
        if (PrSummaryCache.Count > 32)
        {
            foreach (var entry in PrSummaryCache.Where(e => DateTimeOffset.UtcNow - e.Value.At > TimeSpan.FromMinutes(5)).ToList())
                PrSummaryCache.TryRemove(entry.Key, out _);
        }
        return text ?? string.Empty;
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
