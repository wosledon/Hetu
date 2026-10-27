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
    /// <summary><paramref name="timeout"/> 为空时用默认超时（本地 60s / SSH 默认）；网络类命令（pull/push）需显式放宽</summary>
    Task<WorkCommandResult> RunAsync(string command, string? stdin = null, CancellationToken ct = default, TimeSpan? timeout = null);
}

/// <summary>本地执行器：直接起 shell 进程，工作目录为项目根目录</summary>
public class LocalCommandRunner : IWorkCommandRunner
{
    private readonly string _root;

    public LocalCommandRunner(string root) => _root = root;

    public bool IsRemote => false;
    public string RootPath => _root;

    public Task<WorkCommandResult> RunAsync(string command, CancellationToken ct = default) => RunAsync(command, null, ct);

    public async Task<WorkCommandResult> RunAsync(string command, string? stdin, CancellationToken ct = default, TimeSpan? timeout = null)
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
        cts.CancelAfter(timeout ?? TimeSpan.FromSeconds(60));
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

/// <summary>
/// SSH 执行器：默认走持久会话（一条 ssh 连接反复复用，见 <see cref="SshSession"/>），
/// 长命令 / 会话不适用时回退为逐条连接。
/// </summary>
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
    public string BuildSshArgs() => SshProtocol.BuildSshArgs(_project);

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

    public async Task<WorkCommandResult> RunAsync(string command, string? stdin, CancellationToken ct = default, TimeSpan? timeout = null)
    {
        var effective = timeout ?? TimeSpan.FromSeconds(SshCommandTimeoutSeconds);

        // 持久会话：同一条连接反复复用，省掉每次命令的完整握手。三种情况不走会话——
        // 1) 长命令（pull/push）：一条管道同时只能跑一条命令，几分钟的操作会堵住后续命令；
        // 2) 命令里带换行：会破坏单行下发的框架；
        // 3) 带 stdin 而远端没有 base64（协议靠它透传负载）。
        var multiline = command.Contains('\n') || command.Contains('\r');
        if (!multiline && effective <= TimeSpan.FromSeconds(SshSession.MaxCommandTimeoutSeconds))
        {
            var session = await SshSessionManager.GetOrCreateAsync(_project, _decryptPassword, ct).ConfigureAwait(false);
            if (session != null)
            {
                if (!session.IsAlive)
                {
                    // 连接没建起来（网络/认证）：会话已经拿到 ssh 的真实报错，直接透出，
                    // 不再逐条重试——同样的网络再连一次只是多等一个 ConnectTimeout
                    return new WorkCommandResult(255, string.Empty, session.LastConnectError ?? "SSH 连接不可用");
                }
                if (stdin == null || session.SupportsBase64)
                    return await session.ExecuteAsync(BuildRemoteCommand(command), stdin, ct, effective).ConfigureAwait(false);
            }
        }

        return await RunOneShotAsync(command, stdin, ct, effective).ConfigureAwait(false);
    }

    /// <summary>逐条连接执行（会话不适用 / 长命令时的回退路径）</summary>
    private async Task<WorkCommandResult> RunOneShotAsync(string command, string? stdin, CancellationToken ct, TimeSpan timeout)
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
        cts.CancelAfter(timeout);
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
            // 我们的超时（不是调用方取消）：SSH 链路卡住时给个能看懂的原因，
            // 原来的 "The operation was canceled." 只会让人以为是用户点了停止
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException($"ssh 命令超过 {timeout.TotalSeconds:0} 秒无响应（连接可能已断开），请检查网络后重试");
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
