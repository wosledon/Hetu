using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Hetu.Core.Entities;

namespace Hetu.Core.Services.Work;

/// <summary>
/// SSH 持久会话的线路协议（纯函数，便于单测）。
///
/// 会话形态：一个 <c>ssh &lt;args&gt;</c> 进程常驻，远端登录 shell 非交互地从 stdin 逐条读命令。
/// 每条命令单行下发，用唯一标记行分割 stdout / stderr / 退出码：
/// <code>
/// ERR=$( { cd '&lt;root&gt;' &amp;&amp; &lt;command&gt;; } 2&gt;&amp;1 1&gt;&amp;3 ); CODE=$?
/// printf '\nHETU_ERR_&lt;marker&gt; %s\n' "$(printf '%s' "$ERR" | base64 | tr -d '\n')"
/// printf 'HETU_DONE_&lt;marker&gt; %s\n' "$CODE"
/// </code>
/// fd 3 在会话建立时 dup 到 ssh 的 stdout：命令的 stdout 经 fd 3 原样透出，stderr 由命令替换
/// 收进变量后 base64 回传，两条流互不污染（base64 传文件内容、gh 的 JSON 输出都要求 stdout 干净）。
/// stdin 负载（<c>git commit -F -</c>、<c>cat &gt; file</c>）同样 base64 后经管道喂给命令——
/// ssh 的 stdin 是协议通道，不能直接复用。每条命令都跑在 <c>$()</c> 子 shell 里，cd / export 不会跨命令泄漏。
/// </summary>
public static class SshProtocol
{
    public const string DonePrefix = "HETU_DONE_";
    public const string ErrPrefix = "HETU_ERR_";
    public const string SetupPrefix = "HETU_SETUP_";
    public const string Fd3Probe = "HETU_FD3_PROBE";
    public const string Base64Probe = "HETU_B64_PROBE";

    /// <summary>单条命令的唯一标记（32 位十六进制，分支名与命令输出都不可能撞上）</summary>
    public static string NewMarker() => Guid.NewGuid().ToString("N");

    /// <summary>连接签名：同一条连接（主机/端口/用户/认证/密钥/密码）复用同一个会话</summary>
    public static string ConnectionSignature(WorkProject project) => string.Join("|",
        project.SshHost?.Trim() ?? string.Empty,
        project.SshPort.ToString(),
        project.SshUser?.Trim() ?? string.Empty,
        project.SshAuthType ?? string.Empty,
        project.SshKeyPath ?? string.Empty,
        project.SshPasswordProtected ?? string.Empty);

    /// <summary>
    /// 未落库项目（SSH 连接测试 / 远程目录浏览用的是临时对象，Id 每次随机）的稳定 Id：
    /// 按连接参数派生，让同一连接的多次浏览复用同一条会话，又不会与真实项目的 Id 相撞。
    /// </summary>
    public static Guid EphemeralProjectId(WorkProject project)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(ConnectionSignature(project)));
        return new Guid(hash.AsSpan(0, 16));
    }

    /// <summary>ssh 基础参数（不含远端命令）。Windows OpenSSH 不支持 ControlMaster 多路复用，长连接只能由会话自己维持。</summary>
    public static string BuildSshArgs(WorkProject project)
    {
        var args = new StringBuilder();
        args.Append("-p ").Append(project.SshPort <= 0 ? 22 : project.SshPort).Append(' ');
        args.Append("-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ");
        // keepalive：链路半死（VPN 抖动 / NAT 超时）时 ssh 会一直挂着不说话，
        // 5s × 3 次探测，约 15s 内判定连接已断并自行退出
        args.Append("-o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes ");
        if (project.SshAuthType == "Key" && !string.IsNullOrWhiteSpace(project.SshKeyPath))
            args.Append("-i \"").Append(project.SshKeyPath).Append("\" ");
        var target = string.IsNullOrWhiteSpace(project.SshUser)
            ? project.SshHost
            : $"{project.SshUser}@{project.SshHost}";
        args.Append(target);
        return args.ToString();
    }

    /// <summary>会话建立脚本：dup fd 3 到会话 stdout，并探测 fd 重定向与 base64 可用性</summary>
    public static string BuildSetupScript(string marker)
        => $"exec 3>&1; printf '{Fd3Probe}' >&3 2>/dev/null; command -v base64 >/dev/null 2>&1 && printf '{Base64Probe}' >&3; printf '\\n{SetupPrefix}{marker}\\n'";

    /// <summary>单条命令脚本。<paramref name="remoteCommand"/> 已含 cd 前缀；<paramref name="stdin"/> 非空时经 base64 管道喂给命令。</summary>
    public static string BuildCommandScript(string remoteCommand, string marker, string? stdin)
    {
        var body = stdin switch
        {
            null => $"{{ {remoteCommand}; }}",
            "" => $"{{ printf '' | base64 -d | {{ {remoteCommand}; }}; }}",
            _ => $"{{ printf '%s\\n' {ChunkedBase64(stdin)} | base64 -d | {{ {remoteCommand}; }}; }}",
        };
        // 标记行前的 '\n' 保证标记总在行首；同时它恰好抵消命令 stdout 末行的终止符，
        // 于是 ReadLine 拿到的行表用 string.Join("\n", lines) 即可逐字节还原 stdout
        return $"ERR=$( {body} 2>&1 1>&3 ); CODE=$?; "
            + $"printf '\\n{ErrPrefix}{marker} %s\\n' \"$(printf '%s' \"$ERR\" | base64 | tr -d '\\n')\"; "
            + $"printf '{DonePrefix}{marker} %s\\n' \"$CODE\"";
    }

    /// <summary>stdin 的 UTF-8 字节 base64 化后分块（每块单独引号包裹，避免超长单行）</summary>
    public static string ChunkedBase64(string stdin)
    {
        var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(stdin));
        const int chunkSize = 4000;
        var parts = new List<string>();
        for (var i = 0; i < b64.Length; i += chunkSize)
            parts.Add(SshCommandRunner.ShellQuote(b64.Substring(i, Math.Min(chunkSize, b64.Length - i))));
        return string.Join(" ", parts);
    }

    /// <summary>还原命令 stdout（见 <see cref="BuildCommandScript"/> 的换行约定）</summary>
    public static string JoinStdout(List<string> lines) => string.Join("\n", lines);

    public static bool IsErrLine(string line, string marker, out string payload)
    {
        var prefix = ErrPrefix + marker + " ";
        if (line.StartsWith(prefix, StringComparison.Ordinal))
        {
            payload = line[prefix.Length..];
            return true;
        }
        payload = string.Empty;
        return false;
    }

    public static bool IsDoneLine(string line, string marker, out int exitCode)
    {
        var prefix = DonePrefix + marker + " ";
        if (line.StartsWith(prefix, StringComparison.Ordinal) && int.TryParse(line[prefix.Length..], out var code))
        {
            exitCode = code;
            return true;
        }
        exitCode = -1;
        return false;
    }

    /// <summary>base64 解码（容错：非法内容返回 null，调用方按空 stderr 处理）</summary>
    public static string? DecodeBase64(string payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return string.Empty;
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(payload));
        }
        catch (FormatException)
        {
            return null;
        }
    }
}

/// <summary>SSH 连接建立结果</summary>
internal enum SshConnectOutcome
{
    /// <summary>会话可用</summary>
    Connected,

    /// <summary>远端 shell 不支持协议（如 csh 无 fd 重定向），应改用逐条连接</summary>
    Unsupported,

    /// <summary>瞬时失败（网络 / 认证），下次命令可重试</summary>
    Failed,
}

/// <summary>
/// 单个 SSH 持久会话：一条 ssh 进程 + 一套标记行协议。进程只在自己手里换（重连），
/// 对象本身长期存活，命令经信号量串行（一条管道同一时刻只能跑一条命令）。
/// </summary>
internal sealed class SshSession : IDisposable
{
    /// <summary>会话单条命令的等待上限；超过它的长命令（pull/push）由调用方改走独立连接，避免堵住会话</summary>
    internal const int MaxCommandTimeoutSeconds = 60;

    private readonly WorkProject _project;
    private readonly string _sshArgs;
    private readonly Func<string, string?> _decryptPassword;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly StringBuilder _stderrNoise = new();
    private int _running;

    private Process? _process;
    private StreamWriter? _stdin;
    private StreamReader? _stdout;
    private Task? _stderrDrain;
    private string? _askpass;

    internal SshSession(WorkProject project, Func<string, string?> decryptPassword)
    {
        _project = project;
        _sshArgs = SshProtocol.BuildSshArgs(project);
        _decryptPassword = decryptPassword;
    }

    internal string? LastConnectError { get; private set; }

    /// <summary>远端是否有 base64（stdin 负载依赖它；没有时调用方对带 stdin 的命令改走独立连接）</summary>
    internal bool SupportsBase64 { get; private set; }

    internal DateTime LastUsedUtc { get; private set; } = DateTime.UtcNow;

    /// <summary>是否有命令正在执行（回收时跳过，避免把在飞的命令连管道一起收掉）</summary>
    internal bool IsBusy => Volatile.Read(ref _running) > 0;

    internal bool IsAlive => _process != null && !_process.HasExited;

    /// <summary>确保连接可用（幂等，自持锁）；已在连接中时直接返回。</summary>
    internal async Task<SshConnectOutcome> EnsureConnectedAsync(CancellationToken ct)
    {
        if (IsAlive) return SshConnectOutcome.Connected;
        await _gate.WaitAsync(ct);
        try
        {
            return IsAlive ? SshConnectOutcome.Connected : await ConnectAsync(ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<SshConnectOutcome> ConnectAsync(CancellationToken ct)
    {
        KillProcess();
        _stderrNoise.Clear();
        LastConnectError = null;
        _askpass ??= CreateAskpass();

        var psi = new ProcessStartInfo
        {
            FileName = "ssh",
            Arguments = _sshArgs,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        // 密码认证：Unix 通过 SSH_ASKPASS 辅助输入；Windows OpenSSH 无 askpass 机制，需改用密钥
        if (_askpass != null)
        {
            psi.Environment["SSH_ASKPASS"] = _askpass;
            psi.Environment["SSH_ASKPASS_REQUIRE"] = "force";
            if (!psi.Environment.TryGetValue("DISPLAY", out var display) || string.IsNullOrEmpty(display))
                psi.Environment["DISPLAY"] = ":0";
        }

        Process? process;
        try
        {
            process = Process.Start(psi);
        }
        catch (Exception ex)
        {
            LastConnectError = $"无法启动 ssh：{ex.Message}";
            return SshConnectOutcome.Failed;
        }
        if (process == null)
        {
            LastConnectError = "无法启动 ssh";
            return SshConnectOutcome.Failed;
        }

        _process = process;
        _stdin = process.StandardInput;
        _stdin.AutoFlush = false;
        _stdout = process.StandardOutput;
        // ssh 自己的 stderr（"Pseudo-terminal will not be allocated" 等）只做诊断，不进命令结果
        _stderrDrain = Task.Run(async () =>
        {
            try
            {
                var buffer = new char[4096];
                while (true)
                {
                    var read = await process.StandardError.ReadAsync(buffer, CancellationToken.None).ConfigureAwait(false);
                    if (read <= 0) break;
                    lock (_stderrNoise)
                    {
                        _stderrNoise.Append(buffer, 0, read);
                        if (_stderrNoise.Length > 8192) _stderrNoise.Remove(0, _stderrNoise.Length - 8192);
                    }
                }
            }
            catch
            {
                // 连接被 Kill 时读会抛异常，属预期
            }
        });

        var marker = SshProtocol.NewMarker();
        try
        {
            await WriteLineAsync(SshProtocol.BuildSetupScript(marker), ct).ConfigureAwait(false);
            var setup = await ReadSetupAsync(marker, TimeSpan.FromSeconds(20), ct).ConfigureAwait(false);
            if (!setup.SawMarker)
            {
                // 没拿到建立标记：网络/认证失败；远端已经有过输出（横幅/报错）才可能是 shell 不兼容
                LastConnectError = setup.SawOutput
                    ? $"SSH 会话建立失败：远端 shell 未响应（{FirstNoiseLine() ?? "无错误输出"}）"
                    : $"SSH 连接失败（{FirstNoiseLine() ?? "连接被拒绝或超时"}）";
                KillProcess();
                return setup.SawOutput ? SshConnectOutcome.Unsupported : SshConnectOutcome.Failed;
            }
            if (!setup.SawFd3)
            {
                // 远端 shell 不支持 fd 重定向（如 csh）：协议不适用，改用逐条连接
                LastConnectError = "远端 shell 不支持 fd 重定向，已回退为逐条连接";
                KillProcess();
                return SshConnectOutcome.Unsupported;
            }
            SupportsBase64 = setup.SawBase64;
            return SshConnectOutcome.Connected;
        }
        catch (Exception ex)
        {
            LastConnectError = $"SSH 会话建立失败：{ex.Message}";
            KillProcess();
            return SshConnectOutcome.Failed;
        }
    }

    /// <summary>执行一条命令。调用方需保证 timeout 不超过 <see cref="MaxCommandTimeoutSeconds"/>。</summary>
    internal async Task<WorkCommandResult> ExecuteAsync(string remoteCommand, string? stdin, CancellationToken ct, TimeSpan timeout)
    {
        LastUsedUtc = DateTime.UtcNow;
        Interlocked.Increment(ref _running);
        await _gate.WaitAsync(ct);
        try
        {
            // 锁内重连：进程可能在上一条命令后死去，这里原地重建，不换会话对象
            if (!IsAlive)
            {
                var outcome = await ConnectAsync(ct).ConfigureAwait(false);
                if (outcome != SshConnectOutcome.Connected)
                    return new WorkCommandResult(255, string.Empty, LastConnectError ?? "SSH 连接不可用");
            }

            var marker = SshProtocol.NewMarker();
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);
            try
            {
                await WriteLineAsync(SshProtocol.BuildCommandScript(remoteCommand, marker, stdin), cts.Token).ConfigureAwait(false);
                return await ReadFramedResultAsync(_stdout!, marker, cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                // 超时：命令可能还在远端跑，残留输出会污染后续命令，整条会话作废重连
                KillProcess();
                throw new TimeoutException($"ssh 命令超过 {timeout.TotalSeconds:0} 秒无响应（连接可能已断开），请检查网络后重试");
            }
            catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException or EndOfStreamException)
            {
                // 管道断裂 / 进程退出：连接已死，返回 ssh 的传输层失败码让调用方重试
                KillProcess();
                return new WorkCommandResult(255, string.Empty, $"ssh 连接已断开：{ex.Message}");
            }
        }
        finally
        {
            _gate.Release();
            Interlocked.Decrement(ref _running);
        }
    }

    /// <summary>读一条命令的框架化结果（供单测用脚本化流直接验证）</summary>
    internal static async Task<WorkCommandResult> ReadFramedResultAsync(TextReader reader, string marker, CancellationToken ct)
    {
        var lines = new List<string>();
        string? stderrB64 = null;
        var exitCode = -1;
        while (true)
        {
            var line = await reader.ReadLineAsync(ct).ConfigureAwait(false);
            if (line == null) throw new EndOfStreamException("ssh 连接已断开");
            if (SshProtocol.IsErrLine(line, marker, out var payload))
            {
                stderrB64 = payload;
                continue;
            }
            if (SshProtocol.IsDoneLine(line, marker, out var code))
            {
                exitCode = code;
                break;
            }
            lines.Add(line);
        }
        var stderr = SshProtocol.DecodeBase64(stderrB64 ?? string.Empty) ?? string.Empty;
        return new WorkCommandResult(exitCode, SshProtocol.JoinStdout(lines), stderr);
    }

    private async Task WriteLineAsync(string line, CancellationToken ct)
    {
        if (_stdin == null) throw new InvalidOperationException("ssh 会话未连接");
        await _stdin.WriteAsync(line.AsMemory(), ct).ConfigureAwait(false);
        await _stdin.WriteAsync("\n".AsMemory(), ct).ConfigureAwait(false);
        await _stdin.FlushAsync(ct).ConfigureAwait(false);
    }

    private async Task<(bool SawMarker, bool SawFd3, bool SawBase64, bool SawOutput)> ReadSetupAsync(
        string marker, TimeSpan timeout, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        var sawMarker = false;
        var sawFd3 = false;
        var sawBase64 = false;
        var sawOutput = false;
        try
        {
            while (true)
            {
                var line = await _stdout!.ReadLineAsync(cts.Token).ConfigureAwait(false);
                if (line == null) break;
                if (line.Length > 0) sawOutput = true;
                if (line.Contains(SshProtocol.Fd3Probe, StringComparison.Ordinal)) sawFd3 = true;
                if (line.Contains(SshProtocol.Base64Probe, StringComparison.Ordinal)) sawBase64 = true;
                if (line.StartsWith(SshProtocol.SetupPrefix + marker, StringComparison.Ordinal))
                {
                    sawMarker = true;
                    break;
                }
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // 建立超时：按失败处理
        }
        return (sawMarker, sawFd3, sawBase64, sawOutput);
    }

    /// <summary>密码认证的 askpass 辅助脚本（仅 Unix；Windows OpenSSH 无 askpass 机制）</summary>
    private string? CreateAskpass()
    {
        if (OperatingSystem.IsWindows() || _project.SshAuthType != "Password") return null;
        var password = _decryptPassword(_project.SshPasswordProtected ?? string.Empty);
        if (string.IsNullOrEmpty(password)) return null;
        var path = Path.Combine(Path.GetTempPath(), $"hetu-askpass-{_project.Id:N}.sh");
        File.WriteAllText(path, $"#!/bin/sh\nprintf '%s\\n' {SshCommandRunner.ShellQuote(password)}\n");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return path;
    }

    private string? FirstNoiseLine()
    {
        lock (_stderrNoise)
        {
            var text = _stderrNoise.ToString();
            // "Pseudo-terminal will not be allocated…" 是不分配 TTY 的正常提示，不是错误
            return text.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(l => l.Trim())
                .FirstOrDefault(l => l.Length > 0
                    && !l.Contains("Pseudo-terminal will not be allocated", StringComparison.Ordinal));
        }
    }

    private void KillProcess()
    {
        var process = _process;
        _process = null;
        _stdin = null;
        _stdout = null;
        if (process == null) return;
        try { process.Kill(entireProcessTree: true); } catch { }
        try { process.Dispose(); } catch { }
    }

    public void Dispose()
    {
        KillProcess();
        try { _stdin?.Dispose(); } catch { }
        try { _stdout?.Dispose(); } catch { }
        try { _stderrDrain?.Wait(TimeSpan.FromSeconds(2)); } catch { }
        if (_askpass != null)
        {
            try { File.Delete(_askpass); } catch { }
            _askpass = null;
        }
        try { _gate.Dispose(); } catch { }
    }
}

/// <summary>
/// SSH 持久会话管理：按项目缓存会话（不同项目各一条连接，互不影响），空闲超时自动回收
/// （断开 ssh 进程，下次命令自动重连），进程退出时统一清理，避免残留的后台连接。
/// </summary>
internal static class SshSessionManager
{
    /// <summary>空闲多久后回收会话（断开连接，下次命令自动重连）</summary>
    internal static readonly TimeSpan IdleTimeout = TimeSpan.FromMinutes(10);

    private static readonly ConcurrentDictionary<Guid, Entry> Sessions = new();
    private static readonly Timer Reaper = new(_ => ReapIdle(), null, TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(2));

    private sealed class Entry(string signature)
    {
        public string Signature { get; } = signature;
        public SshSession? Session { get; set; }
        public bool Unsupported { get; set; }
        public DateTime LastUsedUtc { get; set; } = DateTime.UtcNow;
        public SemaphoreSlim ConnectGate { get; } = new(1, 1);

        public void Dispose()
        {
            try { Session?.Dispose(); } catch { }
            try { ConnectGate.Dispose(); } catch { }
        }
    }

    static SshSessionManager()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            try { DisposeAll(); } catch { }
        };
    }

    /// <summary>取（或建）会话。返回 null 只表示该远端 shell 不适用持久会话，调用方应逐条连接执行；
    /// 连接没建起来时返回的会话 <see cref="SshSession.IsAlive"/> 为 false，调用方直接读
    /// <see cref="SshSession.LastConnectError"/> 报错即可。</summary>
    internal static async Task<SshSession?> GetOrCreateAsync(WorkProject project, Func<string, string?> decryptPassword, CancellationToken ct)
    {
        ReapIdle();
        var signature = SshProtocol.ConnectionSignature(project);
        var entry = Sessions.GetOrAdd(project.Id, _ => new Entry(signature));
        if (!string.Equals(entry.Signature, signature, StringComparison.Ordinal))
        {
            // 项目的连接参数被改过（换了主机/端口/密钥/密码）：旧会话作废重建
            if (Sessions.TryRemove(KeyValuePair.Create(project.Id, entry))) entry.Dispose();
            entry = Sessions.GetOrAdd(project.Id, _ => new Entry(signature));
        }

        await entry.ConnectGate.WaitAsync(ct);
        try
        {
            if (entry.Unsupported) return null;
            var session = entry.Session;
            if (session == null)
            {
                var created = new SshSession(project, decryptPassword);
                var outcome = await created.EnsureConnectedAsync(ct).ConfigureAwait(false);
                switch (outcome)
                {
                    case SshConnectOutcome.Connected:
                        entry.Session = created;
                        break;
                    case SshConnectOutcome.Unsupported:
                        entry.Unsupported = true;
                        created.Dispose();
                        return null;
                    default:
                        // 瞬时失败（网络/认证）：会话留着（下次命令重连），但不标记为可用——
                        // 调用方直接拿 LastConnectError 报错，不再逐条重试（同样的网络再连一次只是多等一个 ConnectTimeout）
                        entry.Session = created;
                        break;
                }
                session = entry.Session;
            }
            else if (!session.IsAlive)
            {
                // 连接已断：原地重连，保持同一个会话对象（在飞的命令仍持有它）
                await session.EnsureConnectedAsync(ct).ConfigureAwait(false);
            }
            entry.LastUsedUtc = DateTime.UtcNow;
            return session;
        }
        finally
        {
            entry.ConnectGate.Release();
        }
    }

    /// <summary>回收空闲会话（断开 ssh 进程；下次命令自动重连）。执行中的会话跳过。</summary>
    internal static void ReapIdle()
    {
        var now = DateTime.UtcNow;
        foreach (var (id, entry) in Sessions)
        {
            var session = entry.Session;
            if (session != null)
            {
                if (!ShouldReap(entry.LastUsedUtc, session.IsBusy, now)) continue;
            }
            else if (entry.Unsupported || !ShouldReap(entry.LastUsedUtc, busy: false, now))
            {
                // 没有会话的条目：要么是缓存的能力结论（不占资源，永久保留），要么还没闲够
                continue;
            }
            if (Sessions.TryRemove(id, out var removed)) removed.Dispose();
        }
    }

    /// <summary>是否应回收：空闲超时且没有命令在飞</summary>
    internal static bool ShouldReap(DateTime lastUsedUtc, bool busy, DateTime nowUtc)
        => !busy && nowUtc - lastUsedUtc > IdleTimeout;

    /// <summary>断开所有会话（进程退出时调用）</summary>
    internal static void DisposeAll()
    {
        foreach (var (id, _) in Sessions)
        {
            if (Sessions.TryRemove(id, out var removed)) removed.Dispose();
        }
    }
}
