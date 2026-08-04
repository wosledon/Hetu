using System.Diagnostics;
using System.Text;
using System.Threading.Channels;
using Hetu.Core.Interfaces;

namespace Hetu.Api.Services;

/// <summary>
/// 工作终端：为每个项目维护一个后台 shell 进程，通过通道缓冲输出，
/// 供 WebSocket 控制器读写。所有终端以单例运行，键为项目 ID。
/// </summary>
public class WorkTerminalManager
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly Dictionary<Guid, TerminalSession> _sessions = new();

    public WorkTerminalManager(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    public async Task<(TerminalSession session, string? error)> GetOrCreateAsync(Guid projectId, CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (_sessions.TryGetValue(projectId, out var existing) && !existing.Process.HasExited)
            {
                return (existing, null);
            }
            if (existing != null)
            {
                existing.Dispose();
                _sessions.Remove(projectId);
            }

            string? rootPath;
            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
                var project = await unitOfWork.WorkProjects.GetByIdAsync(projectId, ct);
                if (project == null || string.IsNullOrWhiteSpace(project.RootPath) || !Directory.Exists(project.RootPath))
                {
                    return (null!, "项目根目录不存在");
                }
                rootPath = project.RootPath;
            }

            // Windows 用 PowerShell 作为 shell：管道 UTF-8 输入/输出可靠（cmd 在 chcp 65001 下管道输入有 bug）
            string shell;
            string args;
            if (OperatingSystem.IsWindows())
            {
                shell = "powershell.exe";
                args = "-NoLogo -NoExit -Command \"[Console]::InputEncoding=[System.Text.Encoding]::UTF8;[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\"";
            }
            else if (OperatingSystem.IsMacOS())
            {
                shell = "/bin/zsh";
                args = "-i";
            }
            else
            {
                shell = "/bin/bash";
                args = "-i";
            }

            var psi = new ProcessStartInfo
            {
                FileName = shell,
                Arguments = args,
                WorkingDirectory = rootPath,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardInputEncoding = Encoding.UTF8,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var env in new[] { "TERM", "COLORTERM", "LANG" })
            {
                if (psi.Environment.ContainsKey(env)) psi.Environment.Remove(env);
            }
            psi.Environment["TERM"] = "xterm-256color";
            psi.Environment["COLORTERM"] = "truecolor";

            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            if (!process.Start())
            {
                return (null!, "启动终端进程失败");
            }

            var session = new TerminalSession(projectId, process);
            _sessions[projectId] = session;
            return (session, null);
        }
        finally
        {
            _lock.Release();
        }
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
}

/// <summary>单个终端会话：进程 + 输出通道</summary>
public class TerminalSession : IDisposable
{
    public Guid ProjectId { get; }
    public Process Process { get; }
    private readonly Channel<string> _outputChannel;
    public ChannelReader<string> Output => _outputChannel.Reader;
    private readonly CancellationTokenSource _cts = new();

    public TerminalSession(Guid projectId, Process process)
    {
        ProjectId = projectId;
        Process = process;
        _outputChannel = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = false, SingleWriter = false });

        process.Exited += (_, _) => _outputChannel.Writer.TryComplete();

        // 按原始字节块读取，保证提示符等无换行内容也能实时推送
        _ = PumpStreamAsync(process.StandardOutput.BaseStream);
        _ = PumpStreamAsync(process.StandardError.BaseStream);
    }

    private async Task PumpStreamAsync(Stream stream)
    {
        var buffer = new byte[4096];
        var decoder = Encoding.UTF8.GetDecoder();
        var charBuffer = new char[4096];
        try
        {
            while (!_cts.IsCancellationRequested)
            {
                var read = await stream.ReadAsync(buffer, _cts.Token);
                if (read <= 0) break;
                var chars = decoder.GetChars(buffer, 0, read, charBuffer, 0);
                if (chars > 0)
                {
                    _outputChannel.Writer.TryWrite(new string(charBuffer, 0, chars));
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
    }

    public void Write(string text)
    {
        if (!Process.HasExited)
        {
            Process.StandardInput.Write(text);
            Process.StandardInput.Flush();
        }
    }

    public void WriteLine(string line) => Write(line + Environment.NewLine);

    public void Dispose()
    {
        _cts.Cancel();
        try
        {
            if (!Process.HasExited)
            {
                Process.Kill(entireProcessTree: true);
                Process.WaitForExit(2000);
            }
        }
        catch { }
        _cts.Dispose();
        Process.Dispose();
    }
}
