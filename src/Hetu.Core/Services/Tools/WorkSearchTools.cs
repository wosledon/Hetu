using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>按 glob 模式查找项目内的文件（只读）</summary>
public class WorkGlobTool : IToolExecutor
{
    private const int MaxResults = 500;
    private const int MaxScannedFiles = 20000;

    private readonly WorkToolContext _context;

    public WorkGlobTool(WorkToolContext context) => _context = context;

    public string Name => "work_glob";
    public string Description => "按 glob 模式查找项目内的文件路径（如 **/*.cs、src/**/Work*.tsx），返回相对项目根的路径";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "查找文件位置时优先使用，避免用 work_list_dir 逐层遍历。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "pattern": { "type": "string", "description": "glob 模式，支持 *、**、?，如 **/*.cs" },
            "path": { "type": "string", "description": "限定搜索的子目录（相对项目根），可选" },
            "maxResults": { "type": "integer", "description": "最大返回数量，默认 200" }
        },
        "required": ["pattern"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var pattern = args.TryGetProperty("pattern", out var p) ? p.GetString() ?? "" : "";
            var subPath = args.TryGetProperty("path", out var sp) ? sp.GetString() ?? "" : "";
            var limit = args.TryGetProperty("maxResults", out var mr) && mr.TryGetInt32(out var lv) ? Math.Clamp(lv, 1, MaxResults) : 200;

            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return Task.FromResult(ToolExecutionResult.Error("项目根目录不存在"));
            if (string.IsNullOrWhiteSpace(pattern))
                return Task.FromResult(ToolExecutionResult.Error("pattern 不能为空"));

            var normalized = pattern.Replace('\\', '/').TrimStart('/');
            if (!normalized.Contains('/')) normalized = "**/" + normalized;

            var searchRoot = string.IsNullOrWhiteSpace(subPath) ? root : WorkPath.Resolve(root, subPath);
            if (searchRoot == null || !Directory.Exists(searchRoot))
                return Task.FromResult(ToolExecutionResult.Error($"目录不存在或超出项目范围: {subPath}"));

            var regex = WorkToolPolicy.GlobToRegex(normalized);
            var matches = new List<string>();
            var scanned = 0;

            foreach (var file in EnumerateFiles(root, searchRoot, cancellationToken))
            {
                scanned++;
                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                if (WorkProjectRules.IsIgnored(root, relative)) continue;
                if (!regex.IsMatch(relative)) continue;

                matches.Add(relative);
                if (matches.Count >= limit) break;
            }

            if (matches.Count == 0)
                return Task.FromResult(ToolExecutionResult.Success($"未找到匹配 {pattern} 的文件（已扫描 {scanned} 个文件）"));

            var sb = new StringBuilder();
            foreach (var m in matches.OrderBy(x => x)) sb.AppendLine(m);
            sb.AppendLine($"（{matches.Count} 个匹配，扫描 {scanned} 个文件）");
            return Task.FromResult(ToolExecutionResult.Success(sb.ToString()));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or OperationCanceledException)
        {
            return Task.FromResult(ToolExecutionResult.Error($"查找文件失败: {ex.Message}"));
        }
    }

    private static IEnumerable<string> EnumerateFiles(string root, string dir, CancellationToken cancellationToken)
    {
        var pending = new Stack<string>();
        pending.Push(dir);
        var yielded = 0;

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

            foreach (var file in files)
            {
                yield return file;
                if (++yielded >= MaxScannedFiles) yield break;
            }

            foreach (var sub in subDirs)
            {
                var name = Path.GetFileName(sub);
                if (WorkProjectRules.IsBuiltinIgnoredDir(name)) continue;
                var relative = Path.GetRelativePath(root, sub).Replace('\\', '/');
                if (WorkProjectRules.IsIgnored(root, relative)) continue;
                pending.Push(sub);
            }
        }
    }
}

/// <summary>按正则搜索项目内文件内容（只读）</summary>
public class WorkGrepTool : IToolExecutor
{
    private const int MaxResults = 300;
    private const int MaxScannedFiles = 5000;
    private const int MaxLineChars = 400;

    private readonly WorkToolContext _context;

    public WorkGrepTool(WorkToolContext context) => _context = context;

    public string Name => "work_grep";
    public string Description => "用正则表达式搜索项目内文件内容，返回 文件:行号:内容";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "定位代码符号或文本时使用；pattern 使用 .NET 正则语法。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "pattern": { "type": "string", "description": ".NET 正则表达式" },
            "path": { "type": "string", "description": "限定搜索的子目录（相对项目根），可选" },
            "glob": { "type": "string", "description": "限定文件名的 glob，如 **/*.ts，可选" },
            "caseSensitive": { "type": "boolean", "description": "是否区分大小写，默认 false" },
            "maxResults": { "type": "integer", "description": "最大返回条数，默认 100" }
        },
        "required": ["pattern"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var pattern = args.TryGetProperty("pattern", out var p) ? p.GetString() ?? "" : "";
            var subPath = args.TryGetProperty("path", out var sp) ? sp.GetString() ?? "" : "";
            var glob = args.TryGetProperty("glob", out var g) ? g.GetString() ?? "" : "";
            var caseSensitive = args.TryGetProperty("caseSensitive", out var cs) && cs.ValueKind == JsonValueKind.True;
            var limit = args.TryGetProperty("maxResults", out var mr) && mr.TryGetInt32(out var lv) ? Math.Clamp(lv, 1, MaxResults) : 100;

            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");
            if (string.IsNullOrWhiteSpace(pattern))
                return ToolExecutionResult.Error("pattern 不能为空");

            var options = RegexOptions.CultureInvariant | (caseSensitive ? RegexOptions.None : RegexOptions.IgnoreCase);
            Regex regex;
            try
            {
                regex = new Regex(pattern, options, TimeSpan.FromSeconds(2));
            }
            catch (ArgumentException ex)
            {
                return ToolExecutionResult.Error($"正则表达式非法: {ex.Message}");
            }

            Regex? fileFilter = null;
            if (!string.IsNullOrWhiteSpace(glob))
            {
                var normalizedGlob = glob.Replace('\\', '/').TrimStart('/');
                if (!normalizedGlob.Contains('/')) normalizedGlob = "**/" + normalizedGlob;
                fileFilter = WorkToolPolicy.GlobToRegex(normalizedGlob);
            }

            var searchRoot = string.IsNullOrWhiteSpace(subPath) ? root : WorkPath.Resolve(root, subPath);
            if (searchRoot == null || !Directory.Exists(searchRoot))
                return ToolExecutionResult.Error($"目录不存在或超出项目范围: {subPath}");

            var hits = new List<string>();
            var scanned = 0;
            var truncated = false;

            foreach (var file in EnumerateFiles(root, searchRoot, cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (scanned >= MaxScannedFiles) { truncated = true; break; }

                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                if (WorkProjectRules.IsIgnored(root, relative)) continue;
                if (fileFilter != null && !fileFilter.IsMatch(relative)) continue;
                if (!WorkProjectRules.IsProbablyText(file)) continue;

                scanned++;
                string[] lines;
                try
                {
                    lines = await File.ReadAllLinesAsync(file, cancellationToken);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or DecoderFallbackException)
                {
                    continue;
                }

                for (var i = 0; i < lines.Length; i++)
                {
                    if (!SafeMatch(regex, lines[i])) continue;
                    var text = lines[i].Trim();
                    if (text.Length > MaxLineChars) text = text[..MaxLineChars] + "…";
                    hits.Add($"{relative}:{i + 1}: {text}");
                    if (hits.Count >= limit) { truncated = true; break; }
                }

                if (hits.Count >= limit) break;
            }

            if (hits.Count == 0)
                return ToolExecutionResult.Success($"未找到匹配（已扫描 {scanned} 个文件）");

            var sb = new StringBuilder();
            foreach (var hit in hits) sb.AppendLine(hit);
            sb.AppendLine($"（{hits.Count} 条匹配，扫描 {scanned} 个文件{(truncated ? "，结果已截断" : "")}）");
            return ToolExecutionResult.Success(sb.ToString());
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or OperationCanceledException)
        {
            return ToolExecutionResult.Error($"搜索失败: {ex.Message}");
        }
    }

    private static bool SafeMatch(Regex regex, string input)
    {
        try
        {
            return regex.IsMatch(input);
        }
        catch (RegexMatchTimeoutException)
        {
            return false;
        }
    }

    private static IEnumerable<string> EnumerateFiles(string root, string dir, CancellationToken cancellationToken)
    {
        var pending = new Stack<string>();
        pending.Push(dir);

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
                var name = Path.GetFileName(sub);
                if (WorkProjectRules.IsBuiltinIgnoredDir(name)) continue;
                var relative = Path.GetRelativePath(root, sub).Replace('\\', '/');
                if (WorkProjectRules.IsIgnored(root, relative)) continue;
                pending.Push(sub);
            }
        }
    }
}

/// <summary>精确块替换式修改（比整体覆盖更安全）</summary>
public class WorkApplyPatchTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkApplyPatchTool(WorkToolContext context) => _context = context;

    public string Name => "work_apply_patch";
    public string Description => "在文件内做精确文本替换：把 search 片段替换为 replace 片段；search 必须唯一匹配（或用 replaceAll 替换全部）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;
    public string? UsageGuideline => "修改既有文件时优先使用本工具，只有新建文件或整体重写时才用 work_write_file。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "相对项目根的文件路径" },
            "search": { "type": "string", "description": "要被替换的原文片段（需与文件内容逐字符一致，含缩进）" },
            "replace": { "type": "string", "description": "替换后的新片段" },
            "replaceAll": { "type": "boolean", "description": "是否替换全部匹配，默认 false（要求唯一匹配）" }
        },
        "required": ["path", "search", "replace"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var rel = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            var search = args.TryGetProperty("search", out var s) ? s.GetString() ?? "" : "";
            var replace = args.TryGetProperty("replace", out var r) ? r.GetString() ?? "" : "";
            var replaceAll = args.TryGetProperty("replaceAll", out var ra) && ra.ValueKind == JsonValueKind.True;

            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");
            if (string.IsNullOrEmpty(search)) return ToolExecutionResult.Error("search 不能为空");

            var file = WorkPath.Resolve(root, rel);
            if (file == null) return ToolExecutionResult.Error($"路径超出项目范围: {rel}");
            if (!File.Exists(file)) return ToolExecutionResult.Error($"文件不存在: {rel}（新建文件请用 work_write_file）");

            var original = await File.ReadAllTextAsync(file, cancellationToken);
            var matches = CountOccurrences(original, search);
            if (matches == 0)
                return ToolExecutionResult.Error($"未找到 search 片段，文件内容未被修改（请先 work_read_file 确认原文）");
            if (matches > 1 && !replaceAll)
                return ToolExecutionResult.Error($"search 片段匹配到 {matches} 处，请扩大上下文使其唯一，或指定 replaceAll=true");

            var updated = replaceAll
                ? original.Replace(search, replace)
                : ReplaceFirst(original, search, replace);

            var newline = original.Contains("\r\n") ? "\r\n" : "\n";
            if (newline == "\r\n") updated = updated.Replace("\r\n", "\n").Replace("\n", "\r\n");

            await File.WriteAllTextAsync(file, updated, cancellationToken);
            var delta = updated.Length - original.Length;
            return ToolExecutionResult.Success($"✅ 已修改 {rel}（{matches} 处替换，长度 {delta:+#;-#;0}）");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return ToolExecutionResult.Error($"应用补丁失败: {ex.Message}");
        }
    }

    private static int CountOccurrences(string text, string value)
    {
        var count = 0;
        var index = 0;
        while ((index = text.IndexOf(value, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += value.Length;
        }
        return count;
    }

    private static string ReplaceFirst(string text, string search, string replace)
    {
        var index = text.IndexOf(search, StringComparison.Ordinal);
        return index < 0 ? text : text[..index] + replace + text[(index + search.Length)..];
    }
}

/// <summary>删除项目内文件</summary>
public class WorkDeleteFileTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkDeleteFileTool(WorkToolContext context) => _context = context;

    public string Name => "work_delete_file";
    public string Description => "删除项目内的单个文件（相对项目根路径）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;
    public string? UsageGuideline => "仅在用户明确要求删除文件时使用。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "相对项目根的文件路径" }
        },
        "required": ["path"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var rel = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return Task.FromResult(ToolExecutionResult.Error("项目根目录不存在"));

            var file = WorkPath.Resolve(root, rel);
            if (file == null) return Task.FromResult(ToolExecutionResult.Error($"路径超出项目范围: {rel}"));
            if (Directory.Exists(file)) return Task.FromResult(ToolExecutionResult.Error("本工具只删除文件，不删除目录"));
            if (!File.Exists(file)) return Task.FromResult(ToolExecutionResult.Error($"文件不存在: {rel}"));

            File.Delete(file);
            return Task.FromResult(ToolExecutionResult.Success($"🗑️ 已删除 {rel}"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return Task.FromResult(ToolExecutionResult.Error($"删除文件失败: {ex.Message}"));
        }
    }
}

/// <summary>移动/重命名项目内文件</summary>
public class WorkMoveFileTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkMoveFileTool(WorkToolContext context) => _context = context;

    public string Name => "work_move_file";
    public string Description => "移动或重命名项目内的文件（from → to，均为相对项目根路径）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "from": { "type": "string", "description": "源文件相对路径" },
            "to": { "type": "string", "description": "目标相对路径" }
        },
        "required": ["from", "to"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var from = args.TryGetProperty("from", out var f) ? f.GetString() ?? "" : "";
            var to = args.TryGetProperty("to", out var t) ? t.GetString() ?? "" : "";
            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return Task.FromResult(ToolExecutionResult.Error("项目根目录不存在"));

            var source = WorkPath.Resolve(root, from);
            var target = WorkPath.Resolve(root, to);
            if (source == null) return Task.FromResult(ToolExecutionResult.Error($"路径超出项目范围: {from}"));
            if (target == null) return Task.FromResult(ToolExecutionResult.Error($"路径超出项目范围: {to}"));
            if (!File.Exists(source)) return Task.FromResult(ToolExecutionResult.Error($"源文件不存在: {from}"));
            if (File.Exists(target)) return Task.FromResult(ToolExecutionResult.Error($"目标文件已存在: {to}"));

            var dir = Path.GetDirectoryName(target);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.Move(source, target);
            return Task.FromResult(ToolExecutionResult.Success($"📦 已移动 {from} → {to}"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return Task.FromResult(ToolExecutionResult.Error($"移动文件失败: {ex.Message}"));
        }
    }
}

/// <summary>只读 git 查询</summary>
public class WorkGitTool : IToolExecutor
{
    private static readonly HashSet<string> AllowedSubcommands = new(StringComparer.OrdinalIgnoreCase)
    {
        "status", "diff", "log", "show", "blame", "ls-files", "rev-parse",
        "shortlog", "describe", "remote", "tag", "stash", "branch", "grep", "grep ",
    };

    private static readonly string[] DeniedArgs =
    [
        "-c", "--exec-path", "--upload-pack", "--output", "-o", "--ext-diff", "--no-index", "--exec",
    ];

    private readonly WorkToolContext _context;

    public WorkGitTool(WorkToolContext context) => _context = context;

    public string Name => "work_git";
    public string Description => "执行只读 git 查询（status/diff/log/show/blame/branch 等），返回命令输出";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "查看版本历史与变更时使用；提交、推送等写操作请用 work_run_command。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "args": { "type": "string", "description": "git 子命令及参数，如 \"diff --stat\"、\"log --oneline -10\"" }
        },
        "required": ["args"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var gitArgs = args.TryGetProperty("args", out var a) ? a.GetString() ?? "" : "";
            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");
            if (string.IsNullOrWhiteSpace(gitArgs)) return ToolExecutionResult.Error("args 不能为空");

            var tokens = gitArgs.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var subcommand = tokens[0];
            if (!AllowedSubcommands.Contains(subcommand))
                return ToolExecutionResult.Error($"work_git 仅支持只读子命令，已拒绝: {subcommand}");

            if (tokens.Skip(1).Any(t => DeniedArgs.Contains(t, StringComparer.OrdinalIgnoreCase)))
                return ToolExecutionResult.Error("命令包含不被允许的参数");

            if (subcommand.Equals("stash", StringComparison.OrdinalIgnoreCase) &&
                tokens.Length > 1 && !tokens[1].Equals("list", StringComparison.OrdinalIgnoreCase) &&
                !tokens[1].Equals("show", StringComparison.OrdinalIgnoreCase))
            {
                return ToolExecutionResult.Error("work_git 仅支持 stash list / stash show");
            }

            if (subcommand.Equals("branch", StringComparison.OrdinalIgnoreCase) &&
                tokens.Skip(1).Any(t => t is "-d" or "-D" or "-m" or "-M" or "-c" or "-C"))
            {
                return ToolExecutionResult.Error("work_git 不支持修改分支，请用 work_run_command");
            }

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "git",
                WorkingDirectory = root,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("--no-pager");
            foreach (var token in tokens) psi.ArgumentList.Add(token);

            using var process = System.Diagnostics.Process.Start(psi);
            if (process == null) return ToolExecutionResult.Error("启动 git 失败");

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(20));
            var stdoutTask = process.StandardOutput.ReadToEndAsync(cts.Token);
            var stderrTask = process.StandardError.ReadToEndAsync(cts.Token);
            await process.WaitForExitAsync(cts.Token);
            var outText = await stdoutTask;
            var errText = await stderrTask;

            var sb = new StringBuilder();
            if (!string.IsNullOrWhiteSpace(outText)) sb.AppendLine(Truncate(outText.TrimEnd()));
            if (!string.IsNullOrWhiteSpace(errText)) sb.AppendLine("[stderr] " + Truncate(errText.TrimEnd()));
            sb.AppendLine($"（退出码 {process.ExitCode}）");
            return process.ExitCode == 0
                ? ToolExecutionResult.Success(sb.ToString())
                : ToolExecutionResult.Error(sb.ToString());
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or IOException or OperationCanceledException or JsonException)
        {
            return ToolExecutionResult.Error($"执行 git 失败: {ex.Message}");
        }
    }

    private static string Truncate(string text, int max = 20000)
        => text.Length <= max ? text : text[..max] + $"\n…（输出超过 {max} 字符已截断）";
}
