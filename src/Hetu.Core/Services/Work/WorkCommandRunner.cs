using System.Diagnostics;
using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;

namespace Hetu.Core.Services.Work;

public record WorkCommandResult(int ExitCode, string StdOut, string StdErr)
{
    public string Combined => string.IsNullOrWhiteSpace(StdErr) ? StdOut : StdOut + StdErr;
}

/// <summary>
/// 项目命令执行器：本地项目直接在根目录执行；SSH 项目通过系统 ssh 客户端执行。
/// 远端命令统一以 cd &lt;root&gt; &amp;&amp; ... 前缀保证工作目录。
/// </summary>
public interface IWorkCommandRunner
{
    bool IsRemote { get; }
    string RootPath { get; }
    Task<WorkCommandResult> RunAsync(string command, CancellationToken ct = default);
    Task<WorkCommandResult> RunAsync(string command, string? stdin, CancellationToken ct = default);
}

/// <summary>本地执行器：直接起 shell 进程，工作目录为项目根目录</summary>
public class LocalCommandRunner : IWorkCommandRunner
{
    private readonly string _root;

    public LocalCommandRunner(string root) => _root = root;

    public bool IsRemote => false;
    public string RootPath => _root;

    public Task<WorkCommandResult> RunAsync(string command, CancellationToken ct = default) => RunAsync(command, null, ct);

    public async Task<WorkCommandResult> RunAsync(string command, string? stdin, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "powershell.exe" : "/bin/bash",
            // Windows 用 -EncodedCommand：-Command 需要 \" 转义，而 Windows 命令行层会做引号翻转，
            // 结果 "path" arg 被并成单个参数（工作树目录名会多出 " main"）。base64 脚本没有任何外层转义
            Arguments = OperatingSystem.IsWindows()
                ? $"-NoLogo -NoProfile -EncodedCommand {Convert.ToBase64String(Encoding.Unicode.GetBytes(command))}"
                : $"-c \"{command.Replace("\"", "\\\"")}\"",
            WorkingDirectory = _root,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = stdin != null,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        if (stdin != null) psi.StandardInputEncoding = Encoding.UTF8;
        using var process = Process.Start(psi);
        if (process == null) return new WorkCommandResult(-1, string.Empty, "无法启动进程");
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(60));
        try
        {
            if (stdin != null)
            {
                await process.StandardInput.WriteAsync(stdin.AsMemory(), cts.Token);
                process.StandardInput.Close();
            }
            // stdout / stderr 必须并发读：顺序 ReadToEnd 时，子进程写满未读的那根管道就会阻塞，
            // 于是另一根永远等不到 EOF（表现为命令挂到超时）
            var outputTask = process.StandardOutput.ReadToEndAsync(cts.Token);
            var errorTask = process.StandardError.ReadToEndAsync(cts.Token);
            await Task.WhenAll(outputTask, errorTask);
            await process.WaitForExitAsync(cts.Token);
            return new WorkCommandResult(process.ExitCode, outputTask.Result, errorTask.Result);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
    }
}

/// <summary>SSH 执行器：调用系统 ssh 客户端，非交互式执行远端命令</summary>
public class SshCommandRunner : IWorkCommandRunner
{
    private readonly WorkProject _project;
    private readonly Func<string, string?> _decryptPassword;

    public SshCommandRunner(WorkProject project, Func<string, string?> decryptPassword)
    {
        _project = project;
        _decryptPassword = decryptPassword;
    }

    public bool IsRemote => true;
    public string RootPath => _project.RootPath;

    /// <summary>单条远端命令的等待上限；正常 ls/find 都在 1s 内返回，超时即视为链路故障</summary>
    private const int SshCommandTimeoutSeconds = 60;

    /// <summary>拼接 ssh 基础参数（不含远端命令）</summary>
    public string BuildSshArgs()
    {
        var args = new StringBuilder();
        args.Append("-p ").Append(_project.SshPort <= 0 ? 22 : _project.SshPort).Append(' ');
        args.Append("-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ");
        // keepalive：链路半死（VPN 抖动 / NAT 超时）时 ssh 会一直挂着不说话，
        // 5s × 3 次探测，约 15s 内判定连接已断并自行退出（否则只能等我们自己的 60s 超时）
        args.Append("-o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes ");
        if (_project.SshAuthType == "Key" && !string.IsNullOrWhiteSpace(_project.SshKeyPath))
            args.Append("-i \"").Append(_project.SshKeyPath).Append("\" ");
        var target = string.IsNullOrWhiteSpace(_project.SshUser)
            ? _project.SshHost
            : $"{_project.SshUser}@{_project.SshHost}";
        args.Append(target);
        return args.ToString();
    }

    /// <summary>远端命令：cd 到项目根目录后执行</summary>
    public string BuildRemoteCommand(string command)
    {
        return $"cd {QuoteRootPath(_project.RootPath)} && {command}";
    }

    /// <summary>
    /// 项目根目录的 shell 引用。波浪号必须保留展开（单引号会阻止展开导致 cd '~' 失败），
    /// 其余路径用单引号安全包裹；双引号内的 $HOME 仍会展开且空格安全。
    /// </summary>
    private static string QuoteRootPath(string? root)
    {
        var value = (root ?? string.Empty).Trim();
        if (value.Length == 0) return "\"$HOME\"";

        // 兼容 Windows 习惯写法（\~、\~/x）归一为 ~ 形式
        if (value.StartsWith("\\~")) value = "~" + value[2..];

        if (value == "~") return "\"$HOME\"";
        if (value.StartsWith("~/"))
        {
            var rest = value[2..].Replace("\"", "\\\"");
            return rest.Length == 0 ? "\"$HOME\"" : $"\"$HOME/{rest}\"";
        }

        return ShellQuote(value);
    }

    public Task<WorkCommandResult> RunAsync(string command, CancellationToken ct = default) => RunAsync(command, null, ct);

    public async Task<WorkCommandResult> RunAsync(string command, string? stdin, CancellationToken ct = default)
    {
        var remote = BuildRemoteCommand(command);
        var psi = new ProcessStartInfo
        {
            FileName = "ssh",
            Arguments = $"{BuildSshArgs()} \"{remote.Replace("\"", "\\\"")}\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = stdin != null,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        if (stdin != null) psi.StandardInputEncoding = Encoding.UTF8;

        // 密码认证：Unix 通过 SSH_ASKPASS 辅助输入；Windows OpenSSH 无 askpass 机制，需改用密钥
        string? askpass = null;
        if (_project.SshAuthType == "Password" && !OperatingSystem.IsWindows())
        {
            var password = _decryptPassword(_project.SshPasswordProtected ?? string.Empty);
            if (!string.IsNullOrEmpty(password))
            {
                askpass = Path.Combine(Path.GetTempPath(), $"hetu-askpass-{_project.Id:N}.sh");
                await File.WriteAllTextAsync(askpass, $"#!/bin/sh\nprintf '%s\\n' {SshCommandRunner.ShellQuote(password)}\n");
                File.SetUnixFileMode(askpass, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                psi.Environment["SSH_ASKPASS"] = askpass;
                psi.Environment["SSH_ASKPASS_REQUIRE"] = "force";
                psi.Environment["DISPLAY"] = psi.Environment.TryGetValue("DISPLAY", out var display) && !string.IsNullOrEmpty(display) ? display : ":0";
            }
        }

        using var process = Process.Start(psi);
        if (process == null)
        {
            if (askpass != null) { try { File.Delete(askpass); } catch { } }
            return new WorkCommandResult(-1, string.Empty, "无法启动 ssh");
        }
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(SshCommandTimeoutSeconds));
        try
        {
            if (stdin != null)
            {
                await process.StandardInput.WriteAsync(stdin.AsMemory(), cts.Token);
                process.StandardInput.Close();
            }
            // 同本地执行器：stdout / stderr 并发读，避免一根管道写满阻塞导致整个命令挂死
            var outputTask = process.StandardOutput.ReadToEndAsync(cts.Token);
            var errorTask = process.StandardError.ReadToEndAsync(cts.Token);
            await Task.WhenAll(outputTask, errorTask);
            await process.WaitForExitAsync(cts.Token);
            return new WorkCommandResult(process.ExitCode, outputTask.Result, errorTask.Result);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // 我们的 60s 超时（不是调用方取消）：SSH 链路卡住时给个能看懂的原因，
            // 原来的 "The operation was canceled." 只会让人以为是用户点了停止
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException($"ssh 命令超过 {SshCommandTimeoutSeconds} 秒无响应（连接可能已断开），请检查网络后重试");
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
        finally
        {
            if (askpass != null) { try { File.Delete(askpass); } catch { } }
        }
    }

    /// <summary>单引号安全包裹（POSIX shell）</summary>
    public static string ShellQuote(string value) => "'" + value.Replace("'", "'\\''") + "'";
}

/// <summary>按项目返回本地/SSH 执行器</summary>
public interface IWorkCommandRunnerFactory
{
    Task<IWorkCommandRunner?> GetRunnerAsync(Guid projectId, CancellationToken ct = default);
    IWorkCommandRunner Create(WorkProject project);
}

/// <summary>按项目连接类型返回执行器；SSH 项目的密码在此解密</summary>
public class WorkCommandRunnerFactory : IWorkCommandRunnerFactory
{
    private readonly IDataProtectionProvider _dataProtection;
    private readonly IUnitOfWork _unitOfWork;

    public WorkCommandRunnerFactory(IDataProtectionProvider dataProtection, IUnitOfWork unitOfWork)
    {
        _dataProtection = dataProtection;
        _unitOfWork = unitOfWork;
    }

    public IWorkCommandRunner Create(WorkProject project)
    {
        if (project == null) throw new ArgumentNullException(nameof(project));
        if (!string.Equals(project.ConnectionType, "Ssh", StringComparison.OrdinalIgnoreCase))
            return new LocalCommandRunner(project.RootPath);

        string? Decrypt(string value)
        {
            if (string.IsNullOrEmpty(value)) return null;
            try
            {
                return System.Text.Encoding.UTF8.GetString(
                    _dataProtection.CreateProtector("Hetu.Ssh").Unprotect(Convert.FromBase64String(value)));
            }
            catch
            {
                return null;
            }
        }

        return new SshCommandRunner(project, Decrypt);
    }

    public async Task<IWorkCommandRunner?> GetRunnerAsync(Guid projectId, CancellationToken ct = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, ct);
        return project == null ? null : Create(project);
    }
}
