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

            var sb = new System.Text.StringBuilder();
            foreach (var d in Directory.GetDirectories(dir).OrderBy(x => x))
                sb.AppendLine($"📁 {Path.GetRelativePath(root, d).Replace('\\', '/')}/");
            foreach (var f in Directory.GetFiles(dir).OrderBy(x => x))
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

            var sb = new System.Text.StringBuilder();
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
    public string? UsageGuideline => "仅用于明确要求修改/创建代码文件时；写入前应向用户确认。";

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
    private readonly WorkToolContext _context;

    public WorkRunCommandTool(WorkToolContext context) => _context = context;

    public string Name => "work_run_command";
    public string Description => "在项目根目录执行 shell 命令（只读诊断优先，写操作需确认）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "仅用于构建、测试、git 状态等开发操作；破坏性命令禁止执行。";

    private static readonly HashSet<string> Denied = new(StringComparer.OrdinalIgnoreCase)
    {
        "rm", "rmdir", "del", "erase", "format", "diskpart", "reg", "regedit",
        "shutdown", "reboot", "halt", "poweroff", "taskkill", "dd", "mkfs", "fdisk",
        "chmod", "chown", "wget", "sc", "net", "bcdedit", "icacls", "cacls", "takeown",
        "rundll32", "mshta", "wmic", "wscript", "cscript",
    };

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "command": { "type": "string", "description": "要执行的命令" }
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
            var root = _context.ProjectRoot;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                return ToolExecutionResult.Error("项目根目录不存在");
            if (string.IsNullOrWhiteSpace(command)) return ToolExecutionResult.Error("命令不能为空");

            var first = command.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (first != null && Denied.Contains(Path.GetFileNameWithoutExtension(first)))
                return ToolExecutionResult.Error($"禁止执行命令: {first}");

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/bash",
                Arguments = OperatingSystem.IsWindows() ? $"/C \"{command}\"" : $"-c \"{command}\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var process = System.Diagnostics.Process.Start(psi);
            if (process == null) return ToolExecutionResult.Error("启动进程失败");

            var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            await process.WaitForExitAsync(cts.Token);
            var outText = await stdout;
            var errText = await stderr;

            var result = new System.Text.StringBuilder();
            if (!string.IsNullOrWhiteSpace(outText)) result.AppendLine(outText.TrimEnd());
            if (!string.IsNullOrWhiteSpace(errText)) result.AppendLine("[stderr] " + errText.TrimEnd());
            result.AppendLine($"（退出码 {process.ExitCode}）");
            return ToolExecutionResult.Success(result.ToString());
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"执行命令失败: {ex.Message}");
        }
    }
}
