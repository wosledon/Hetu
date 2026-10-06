using System.Diagnostics;
using System.Text;
using System.Threading.Channels;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Work;
using Microsoft.AspNetCore.DataProtection;

namespace Hetu.Api.Services;

/// <summary>
/// 工作终端：为每个项目维护一个伪终端（PTY）会话。
/// 本地项目在项目根目录运行 shell；SSH 项目在 pty 内运行 ssh -tt，操作远程主机。
/// 协议：客户端二进制帧=键盘输入，文本帧=JSON 控制（resize）。
/// </summary>
public class WorkTerminalManager
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IDataProtectionProvider _dataProtection;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly Dictionary<Guid, TerminalSession> _sessions = new();

    public WorkTerminalManager(IServiceScopeFactory scopeFactory, IDataProtectionProvider dataProtection)
    {
        _scopeFactory = scopeFactory;
        _dataProtection = dataProtection;
    }

    public async Task<(TerminalSession? session, string? error)> GetOrCreateAsync(Guid projectId, int cols, int rows, CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (_sessions.TryGetValue(projectId, out var existing) && !existing.HasExited)
            {
                existing.Resize(cols, rows);
                return (existing, null);
            }
            if (existing != null)
            {
                existing.Dispose();
                _sessions.Remove(projectId);
            }

            WorkProject? project;
            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
                project = await unitOfWork.WorkProjects.GetByIdAsync(projectId, ct);
            }
            if (project == null) return (null, "项目不存在");
            if (string.IsNullOrWhiteSpace(project.RootPath)) return (null, "项目根目录未配置");

            var isRemote = project.ConnectionType == "Ssh";
            var session = CreatePty(project, isRemote, cols, rows);
            if (session == null) return (null, "终端启动失败");

            _sessions[projectId] = session;
            return (session, null);
        }
        finally
        {
            _lock.Release();
        }
    }

    private TerminalSession? CreatePty(WorkProject project, bool isRemote, int cols, int rows)
    {
        IPtyProcess pty;
        if (isRemote)
        {
            if (string.IsNullOrWhiteSpace(project.SshHost)) return null;
            var runner = new SshCommandRunner(project, DecryptPassword);
            var sshInner = $"ssh -tt {runner.BuildSshArgs()}";
            if (OperatingSystem.IsWindows())
            {
                pty = new ConPtyProcess(sshInner, Directory.Exists(project.RootPath) ? project.RootPath : Environment.CurrentDirectory, cols, rows);
            }
            else
            {
                pty = CreateUnixPty(sshInner, "/");
            }
            // 连接后进入远端项目根目录（等 ssh 建立连接后再注入，避免被欢迎信息/提示符吞掉）
            _ = Task.Run(async () =>
            {
                await Task.Delay(1500);
                try { await pty.WriteAsync($"cd {SshCommandRunner.ShellQuote(project.RootPath)}\r\n", CancellationToken.None); } catch { }
            });
        }
        else
        {
            if (!Directory.Exists(project.RootPath)) return null;
            if (OperatingSystem.IsWindows())
            {
                // 直接以 powershell 作为 ConPTY 子进程（无需 cmd 包装，避免嵌套引号解析问题）
                var shell = "powershell.exe -NoLogo -NoProfile -NoExit -Command \"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\"";
                pty = new ConPtyProcess(shell, project.RootPath, cols, rows);
            }
            else
            {
                var shell = OperatingSystem.IsMacOS() ? "/bin/zsh -i" : "/bin/bash -i";
                pty = CreateUnixPty(shell, project.RootPath);
            }
        }
        return new TerminalSession(project.Id, pty);
    }

    /// <summary>
    /// Unix 伪终端：探测 script 风格（Linux util-linux 的 -qfc 形式 / macOS BSD 形式），
    /// 两种形式都分配真实 pty，保证交互式程序跨 Linux/macOS 可用。
    /// </summary>
    private static IPtyProcess CreateUnixPty(string innerCommand, string workingDirectory)
    {
        var probe = new ProcessStartInfo
        {
            FileName = "/bin/sh",
            Arguments = "-c \"script -qfc 'exit 0' /dev/null\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        try
        {
            using var probeProcess = Process.Start(probe);
            probeProcess?.WaitForExit(3000);
            if (probeProcess?.ExitCode == 0)
                return new ScriptPtyProcess(innerCommand, workingDirectory);
        }
        catch { /* 探测失败则回退 BSD 形式 */ }
        return ScriptPtyProcess.CreateBsd(innerCommand, workingDirectory);
    }

    public async Task StopAsync(Guid projectId)
    {
        await _lock.WaitAsync();
        try
        {
            if (_sessions.TryGetValue(projectId, out var s))
            {
                s.Dispose();
                _sessions.Remove(projectId);
            }
        }
        finally
        {
            _lock.Release();
        }
    }

    private string? DecryptPassword(string protectedValue)
    {
        if (string.IsNullOrEmpty(protectedValue)) return null;
        try
        {
            var protector = _dataProtection.CreateProtector("Hetu.Ssh");
            return Encoding.UTF8.GetString(protector.Unprotect(Convert.FromBase64String(protectedValue)));
        }
        catch
        {
            return null;
        }
    }
}

/// <summary>单个终端会话：PTY 进程 + 有界输出通道</summary>
public class TerminalSession : IDisposable
{
    public Guid ProjectId { get; }
    private readonly IPtyProcess _pty;
    private readonly Channel<string> _outputChannel;
    public ChannelReader<string> Output => _outputChannel.Reader;
    private readonly CancellationTokenSource _cts = new();

    public TerminalSession(Guid projectId, IPtyProcess pty)
    {
        ProjectId = projectId;
        _pty = pty;
        _outputChannel = Channel.CreateBounded<string>(new BoundedChannelOptions(4096)
        {
            SingleReader = false,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest,
        });
        _ = PumpAsync();
    }

    private async Task PumpAsync()
    {
        try
        {
            await foreach (var chunk in _pty.ReadAllAsync(_cts.Token))
            {
                _outputChannel.Writer.TryWrite(chunk);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception) { }
        finally
        {
            _outputChannel.Writer.TryComplete();
        }
    }

    public bool HasExited { get; private set; }

    public void Write(string text) => _ = _pty.WriteAsync(text, CancellationToken.None);

    public void Resize(int cols, int rows)
    {
        try { _pty.Resize(Math.Clamp(cols, 20, 500), Math.Clamp(rows, 5, 200)); }
        catch { /* 尺寸调整失败不影响终端使用 */ }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _pty.Dispose();
        _cts.Dispose();
        HasExited = true;
    }
}
