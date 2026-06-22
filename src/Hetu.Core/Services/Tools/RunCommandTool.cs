using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.Configuration;

namespace Hetu.Core.Services.Tools;

public class RunCommandTool : IToolExecutor
{
    private readonly IConfiguration _configuration;

    private static readonly HashSet<string> DeniedCommands = new(StringComparer.OrdinalIgnoreCase)
    {
        // 禁止执行具有破坏性的命令
        "rm", "rmdir", "del", "erase", "format", "diskpart", "reg", "regedit",
        "shutdown", "reboot", "halt", "poweroff", "taskkill",
        "dd", "mkfs", "fdisk", "chmod", "chown", "wget",
        "sc", "net", "bcdedit", "icacls", "cacls", "takeown",
        "rundll32", "mshta", "wmic", "wscript", "cscript",
    };

    public RunCommandTool(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public string Name => "run_command";

    public string Description => OperatingSystem.IsWindows()
        ? "执行命令（当前 OS: Windows）。使用 cmd.exe 语法，如 echo、dir、type、findstr 等"
        : OperatingSystem.IsMacOS()
            ? "执行命令（当前 OS: macOS）。使用 zsh/bash 语法，如 echo、ls、cat、grep 等"
            : "执行命令（当前 OS: Linux）。使用 bash 语法，如 echo、ls、cat、grep 等";

    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => OperatingSystem.IsWindows()
        ? "仅用于只读诊断（dir、type、findstr、echo %VAR% 等）；任何写操作或包含 rm/format/del 的命令必须先 ask_question 确认；禁止执行可能危害系统的命令。"
        : "仅用于只读诊断（ls、cat、grep、echo 等）；任何写操作或包含 rm/format 的命令必须先 ask_question 确认；禁止执行可能危害系统的命令。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "command": { "type": "string", "description": "要执行的命令" },
            "args": {
                "type": "array",
                "items": { "type": "string" },
                "description": "命令参数（可选）"
            },
            "workingDir": { "type": "string", "description": "工作目录（可选）" }
        },
        "required": ["command"]
    }
    """).RootElement;

    private static readonly string _osTag = OperatingSystem.IsWindows() ? "Windows (cmd.exe)" : OperatingSystem.IsMacOS() ? "macOS (zsh/bash)" : "Linux (bash)";

    public JsonElement ParametersSchema
    {
        get
        {
            var osCmd = OperatingSystem.IsWindows() ? "echo、dir、type、findstr" : "echo、ls、cat、grep";
            var json = $$"""
            {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "要执行的命令。当前系统: {{_osTag}}，常用命令: {{osCmd}}" },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "命令参数（可选）"
                    },
                    "workingDir": { "type": "string", "description": "工作目录（可选）" }
                },
                "required": ["command"]
            }
            """;
            return JsonDocument.Parse(json).RootElement;
        }
    }

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var command = root.GetProperty("command").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(command))
                return ToolExecutionResult.Error("command 参数不能为空");

            // Extract the base command name for blacklist check
            var baseCommand = command.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
            var fileName = Path.GetFileNameWithoutExtension(baseCommand);

            // Load extra denied commands from config before checking
            var extraDenied = _configuration.GetSection("Tools:RunCommand:DeniedCommands").Get<string[]>();
            if (extraDenied != null)
            {
                foreach (var cmd in extraDenied)
                    DeniedCommands.Add(cmd);
            }

            if (DeniedCommands.Contains(fileName))
                return ToolExecutionResult.Error($"禁止执行该命令: {baseCommand}。");

            string[] args = [];
            if (root.TryGetProperty("args", out var argsProp) && argsProp.ValueKind == JsonValueKind.Array)
            {
                args = argsProp.EnumerateArray()
                    .Where(a => a.ValueKind == JsonValueKind.String)
                    .Select(a => a.GetString() ?? "")
                    .ToArray();
            }

            string? workingDir = null;
            if (root.TryGetProperty("workingDir", out var wdProp) && wdProp.ValueKind == JsonValueKind.String)
                workingDir = wdProp.GetString();

            const int maxOutput = 4000;

            using var process = new Process();

            // Determine if we need a shell wrapper:
            // - .exe files can run directly with UseShellExecute=false
            // - .cmd/.bat/.ps1/.js/etc need cmd.exe /c on Windows
            var isExe = baseCommand.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                || (string.IsNullOrEmpty(Path.GetExtension(baseCommand)) && File.Exists(baseCommand + ".exe"));

            var fullArgs = string.Join(" ", args.Select(a => $"\"{a}\""));
            if (OperatingSystem.IsWindows() && !isExe)
            {
                // Use COMSPEC to locate cmd.exe reliably; fall back to System32\cmd.exe
                var shell = Environment.GetEnvironmentVariable("COMSPEC")
                    ?? Path.Combine(Environment.SystemDirectory, "cmd.exe");
                process.StartInfo.FileName = shell;
                process.StartInfo.Arguments = $"/c {command} {fullArgs}";
            }
            else
            {
                process.StartInfo.FileName = command;
                process.StartInfo.Arguments = fullArgs;
            }

            process.StartInfo.WorkingDirectory = workingDir;
            process.StartInfo.RedirectStandardOutput = true;
            process.StartInfo.RedirectStandardError = true;
            process.StartInfo.UseShellExecute = false;
            process.StartInfo.CreateNoWindow = true;

            process.Start();

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(30));

            try
            {
                await process.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return ToolExecutionResult.Error("命令执行超时（30 秒）");
            }

            // Read output after process exits — avoids race with pipe closure
            var outText = process.StandardOutput.ReadToEnd();
            var errText = process.StandardError.ReadToEnd();

            // Trim and limit output
            if (outText.Length > maxOutput)
                outText = outText[..maxOutput] + "\n...(输出已截断)";

            var result = new StringBuilder();
            if (!string.IsNullOrWhiteSpace(outText))
                result.AppendLine(outText.TrimEnd());

            if (!string.IsNullOrWhiteSpace(errText))
            {
                var trimmedErr = errText;
                if (trimmedErr.Length > 1000)
                    trimmedErr = trimmedErr[..1000] + "\n...(错误输出已截断)";
                result.AppendLine($"[stderr]\n{trimmedErr.TrimEnd()}");
            }

            result.AppendLine($"[exit code: {process.ExitCode}]");

            if (process.ExitCode != 0)
                return ToolExecutionResult.Error(result.ToString().TrimEnd());

            return ToolExecutionResult.Success(result.ToString().TrimEnd());
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"执行命令失败: {ex.Message}");
        }
    }
}
