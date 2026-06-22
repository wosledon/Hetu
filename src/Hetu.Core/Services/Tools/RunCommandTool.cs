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
        "shutdown", "reboot", "halt", "poweroff", "taskkill", "kill",
        "dd", "mkfs", "fdisk", "chmod", "chown", "wget", "curl",
        "sc", "net", "bcdedit", "icacls", "cacls", "takeown",
        "rundll32", "mshta", "wmic", "wscript", "cscript",
    };

    public RunCommandTool(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public string Name => "run_command";
    public string Description => "执行命令行命令或脚本";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "仅用于只读诊断（查看版本、列目录、读文件）；任何写操作或包含 rm/format/del 的命令必须先 ask_question 确认；禁止执行可能危害系统的命令。";

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

    public JsonElement ParametersSchema => _schema;

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

            // Also allow additional denied commands from configuration
            var extraDenied = _configuration.GetSection("Tools:RunCommand:DeniedCommands").Get<string[]>();
            if (extraDenied != null)
            {
                foreach (var cmd in extraDenied)
                    DeniedCommands.Add(cmd);
            }

            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            const int maxOutput = 4000;

            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = command,
                Arguments = string.Join(" ", args.Select(a => $"\"{a}\"")),
                WorkingDirectory = workingDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            // On Windows, try cmd.exe for built-in commands
            if (OperatingSystem.IsWindows() && command is "dir" or "echo" or "ls" or "cat" or "pwd")
            {
                process.StartInfo.FileName = "cmd.exe";
                process.StartInfo.Arguments = $"/c {command} {string.Join(" ", args.Select(a => $"\"{a}\""))}";
            }

            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data != null && stdout.Length < maxOutput)
                    stdout.AppendLine(e.Data);
            };
            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data != null)
                    stderr.AppendLine(e.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

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

            var output = stdout.ToString();
            if (output.Length > maxOutput)
                output = output[..maxOutput] + "\n...(输出已截断)";

            var result = new StringBuilder();
            result.AppendLine(output);

            if (stderr.Length > 0)
            {
                var errText = stderr.ToString();
                if (errText.Length > 1000)
                    errText = errText[..1000] + "\n...(错误输出已截断)";
                result.AppendLine($"[stderr]\n{errText}");
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
