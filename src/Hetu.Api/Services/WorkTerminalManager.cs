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

            var shell = OperatingSystem.IsWindows() ? "cmd.exe" : OperatingSystem.IsMacOS() ? "/bin/zsh" : "/bin/bash";
            var args = OperatingSystem.IsWindows() ? "/Q" : "-i";
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

    public TerminalSession(Guid projectId, Process process)
    {
        ProjectId = projectId;
        Process = process;
        _outputChannel = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = false, SingleWriter = false });

        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data != null) _outputChannel.Writer.TryWrite(e.Data);
        };
        process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null) _outputChannel.Writer.TryWrite(e.Data);
        };
        process.Exited += (_, _) => _outputChannel.Writer.TryComplete();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
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
        try
        {
            if (!Process.HasExited)
            {
                Process.Kill(entireProcessTree: true);
                Process.WaitForExit(2000);
            }
        }
        catch { }
        Process.Dispose();
    }
}
