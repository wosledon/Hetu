using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>当前请求作用域内的工作项目根目录（由 Work 流式控制器设置）</summary>
public class WorkToolContext
{
    public string? ProjectRoot { get; set; }
}

/// <summary>项目内安全路径解析（防目录穿越）</summary>
public static class WorkPath
{
    public static string? Resolve(string root, string relative)
    {
        if (string.IsNullOrWhiteSpace(root)) return null;
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
            !full.Equals(root, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        return full;
    }
}

/// <summary>列出项目内目录/文件</summary>
public class WorkListDirTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkListDirTool(WorkToolContext context) => _context = context;

    public string Name => "work_list_dir";
    public string Description => "列出项目内指定目录（相对项目根）下的子目录与文件";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "相对项目根的目录路径，空串表示根目录" }
        },
        "required": ["path"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var rel = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");

            var dir = WorkPath.Resolve(root, rel);
            if (dir == null || !Directory.Exists(dir))
                return ToolExecutionResult.Error($"目录不存在或超出项目范围: {rel}");

            var sb = new StringBuilder();
            foreach (var d in Directory.GetDirectories(dir)
                .Where(x => !WorkProjectRules.IsBuiltinIgnoredDir(Path.GetFileName(x)))
                .Where(x => !WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, x)))
                .OrderBy(x => x))
                sb.AppendLine($"📁 {Path.GetRelativePath(root, d).Replace('\\', '/')}/");
            foreach (var f in Directory.GetFiles(dir)
                .Where(x => !WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, x)))
                .OrderBy(x => x))
            {
                var fi = new FileInfo(f);
                sb.AppendLine($"📄 {Path.GetRelativePath(root, f).Replace('\\', '/')} ({fi.Length} bytes)");
            }
            return ToolExecutionResult.Success(sb.Length == 0 ? "（空目录）" : sb.ToString());
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"列出目录失败: {ex.Message}");
        }
    }
}

/// <summary>读取项目内文件</summary>
public class WorkReadFileTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkReadFileTool(WorkToolContext context) => _context = context;

    public string Name => "work_read_file";
    public string Description => "读取项目内文件内容（相对项目根的路径）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "相对项目根的文件路径" },
            "startLine": { "type": "integer", "description": "起始行（1 基，可选）" },
            "endLine": { "type": "integer", "description": "结束行（含，可选）" }
        },
        "required": ["path"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var rel = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");

            var file = WorkPath.Resolve(root, rel);
            if (file == null || !File.Exists(file))
                return ToolExecutionResult.Error($"文件不存在或超出项目范围: {rel}");

            var lines = await File.ReadAllLinesAsync(file, cancellationToken);
            int start = args.TryGetProperty("startLine", out var s) && s.TryGetInt32(out var sv) ? sv : 1;
            int end = args.TryGetProperty("endLine", out var e) && e.TryGetInt32(out var ev) ? ev : lines.Length;
            start = Math.Max(1, start);
            end = Math.Min(lines.Length, end);
            if (start > end) return ToolExecutionResult.Error("起始行大于结束行");

            var sb = new StringBuilder();
            for (int i = start - 1; i < end; i++)
                sb.AppendLine($"{i + 1}| {lines[i]}");
            return ToolExecutionResult.Success(sb.ToString());
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"读取文件失败: {ex.Message}");
        }
    }
}

/// <summary>写入/修改项目内文件</summary>
public class WorkWriteFileTool : IToolExecutor
{
    private readonly WorkToolContext _context;

    public WorkWriteFileTool(WorkToolContext context) => _context = context;

    public string Name => "work_write_file";
    public string Description => "创建或覆盖项目内文件（相对项目根的路径），content 为完整文件内容";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;
    public string? UsageGuideline => "仅用于新建文件或整体重写；修改既有文件的局部内容请用 work_apply_patch。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "相对项目根的文件路径" },
            "content": { "type": "string", "description": "完整文件内容" }
        },
        "required": ["path", "content"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var rel = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            var content = args.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");

            var file = WorkPath.Resolve(root, rel);
            if (file == null) return ToolExecutionResult.Error($"路径超出项目范围: {rel}");

            var dir = Path.GetDirectoryName(file);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            await File.WriteAllTextAsync(file, content, cancellationToken);
            return ToolExecutionResult.Success($"✅ 已写入 {rel}（{content.Length} 字符）");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"写入文件失败: {ex.Message}");
        }
    }
}

/// <summary>在项目根目录执行命令</summary>
public class WorkRunCommandTool : IToolExecutor
{
    private const int DefaultTimeoutSeconds = 120;
    private const int MaxTimeoutSeconds = 600;
    private const int MaxOutputChars = 30000;

    private readonly WorkToolContext _context;

    public WorkRunCommandTool(WorkToolContext context) => _context = context;

    public string Name => "work_run_command";
    public string Description => "在项目内执行 shell 命令（可指定工作目录与超时），返回标准输出/错误与退出码";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Execute;
    public string? UsageGuideline => "仅用于构建、测试、lint、git 等开发操作；破坏性命令（删除、格式化、关机等）一律禁止。";

    private static readonly HashSet<string> Denied = new(StringComparer.OrdinalIgnoreCase)
    {
        "rm", "rmdir", "del", "erase", "format", "diskpart", "reg", "regedit",
        "shutdown", "reboot", "halt", "poweroff", "taskkill", "dd", "mkfs", "fdisk",
        "chmod", "chown", "sc", "net", "bcdedit", "icacls", "cacls", "takeown",
        "rundll32", "mshta", "wmic", "wscript", "cscript", "shred", "cipher",
        "rmdir", "rd", "vol", "attrib", "setx", "netsh",
    };

    /// <summary>整条命令中出现即拒绝的高危片段</summary>
    private static readonly string[] DeniedPatterns =
    [
        "rm -rf /", "rm -rf /*", "rm -rf ~", ":(){", "curl | sh", "curl | bash",
        "wget | sh", "wget | bash", "invoke-expression", "iex(", "iex (",
        "> /dev/sda", "mkfs.", "fork bomb", "format c:", "del /f /s /q c:",
    ];

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "command": { "type": "string", "description": "要执行的命令" },
            "cwd": { "type": "string", "description": "相对项目根的工作目录，默认项目根" },
            "timeoutSeconds": { "type": "integer", "description": "超时秒数，默认 120，最大 600" }
        },
        "required": ["command"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            var command = args.TryGetProperty("command", out var c) ? c.GetString() ?? "" : "";
            var cwd = args.TryGetProperty("cwd", out var w) ? w.GetString() ?? "" : "";
            var timeout = args.TryGetProperty("timeoutSeconds", out var t) && t.TryGetInt32(out var tv)
                ? Math.Clamp(tv, 1, MaxTimeoutSeconds)
                : DefaultTimeoutSeconds;

            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");
            if (string.IsNullOrWhiteSpace(command)) return ToolExecutionResult.Error("命令不能为空");

            var denial = CheckSafety(command);
            if (denial != null) return ToolExecutionResult.Error(denial);

            var workDir = root;
            if (!string.IsNullOrWhiteSpace(cwd))
            {
                var resolved = WorkPath.Resolve(root, cwd);
                if (resolved == null || !Directory.Exists(resolved))
                    return ToolExecutionResult.Error($"工作目录不存在或超出项目范围: {cwd}");
                workDir = resolved;
            }

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/bash",
                WorkingDirectory = workDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            if (OperatingSystem.IsWindows())
            {
                psi.ArgumentList.Add("/C");
                psi.ArgumentList.Add(command);
            }
            else
            {
                psi.ArgumentList.Add("-c");
                psi.ArgumentList.Add(command);
            }

            using var process = System.Diagnostics.Process.Start(psi);
            if (process == null) return ToolExecutionResult.Error("启动进程失败");

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(timeout));
            var stdoutTask = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
            var stderrTask = process.StandardError.ReadToEndAsync(CancellationToken.None);

            var timedOut = false;
            try
            {
                await process.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                timedOut = true;
                try
                {
                    if (!process.HasExited) process.Kill(entireProcessTree: true);
                }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                    // 进程可能已自然退出
                }
            }

            var outText = await SafeReadAsync(stdoutTask);
            var errText = await SafeReadAsync(stderrTask);

            var result = new StringBuilder();
            if (!string.IsNullOrWhiteSpace(outText)) result.AppendLine(Truncate(outText.TrimEnd()));
            if (!string.IsNullOrWhiteSpace(errText)) result.AppendLine("[stderr] " + Truncate(errText.TrimEnd()));
            if (timedOut) result.AppendLine($"⏱️ 命令超时（{timeout}s）已被终止，需要更长时间请调大 timeoutSeconds。");
            else result.AppendLine($"（退出码 {process.ExitCode}）");
            return ToolExecutionResult.Success(result.ToString());
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or IOException or JsonException)
        {
            return ToolExecutionResult.Error($"执行命令失败: {ex.Message}");
        }
    }

    /// <summary>
    /// 安全校验：逐段（按 &amp;&amp;、||、;、|、换行切分）检查首个 token，
    /// 避免 `cd x &amp;&amp; rm -rf y` 这类绕过。
    /// </summary>
    public static string? CheckSafety(string command)
    {
        var lower = command.ToLowerInvariant();
        foreach (var pattern in DeniedPatterns)
        {
            if (lower.Contains(pattern)) return $"命令包含被禁止的片段: {pattern}";
        }

        var segments = command.Split(
            ["&&", "||", ";", "|", "\n", "\r", "&"],
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var segment in segments)
        {
            var token = segment.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (token == null) continue;
            token = token.Trim('(', ')', '"', '\'');
            if (token.Length == 0) continue;
            if (Denied.Contains(Path.GetFileNameWithoutExtension(token)))
                return $"禁止执行命令: {token}";
        }

        return null;
    }

    private static async Task<string> SafeReadAsync(Task<string> task)
    {
        try
        {
            return await task;
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException)
        {
            return string.Empty;
        }
    }

    private static string Truncate(string text)
        => text.Length <= MaxOutputChars
            ? text
            : text[..MaxOutputChars] + $"\n…（输出超过 {MaxOutputChars} 字符已截断）";
}
