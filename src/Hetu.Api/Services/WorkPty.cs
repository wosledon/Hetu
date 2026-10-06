using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Hetu.Api.Services;

/// <summary>
/// 伪终端进程抽象：替代原先的管道 shell，让交互式程序（vim/htop/彩色提示符）真正工作。
/// Windows 用 ConPTY（LibraryImport 源生成 P/Invoke），Unix 用 script 工具包装 pty，SSH 项目在 pty 内运行 ssh -tt。
/// </summary>
public interface IPtyProcess : IDisposable
{
    Task WriteAsync(string text, CancellationToken ct);
    IAsyncEnumerable<string> ReadAllAsync(CancellationToken ct);
    void Resize(int cols, int rows);
    void Kill();
}

/* ─────────────── Windows ConPTY ─────────────── */

public partial class ConPtyProcess : IPtyProcess
{
    [LibraryImport("kernel32.dll", SetLastError = true)]
    private static partial int CreatePseudoConsole(Coord size, IntPtr hInput, IntPtr hOutput, uint dwFlags, out IntPtr phPC);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    private static partial int ResizePseudoConsole(IntPtr hPC, Coord size);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    private static partial void ClosePseudoConsole(IntPtr hPC);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandle(IntPtr hObject);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, IntPtr lpPipeAttributes, int nSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct Coord { public short X; public short Y; }

    private const int ProcThreadAttributePseudoConsole = 0x00020016;
    private const int StartfUsestdhandles = 0x00000100;
    private const int ExtendedStartupinfoPresent = 0x00080000;

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public int Cb; public IntPtr Reserved; public IntPtr Desktop; public IntPtr Title;
        public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute;
        public int Flags; public ushort ShowWindow, CbReserved2; public IntPtr Reserved2;
        public IntPtr StdInput, StdOutput, StdError;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation { public IntPtr Process, Thread; public int ProcessId, ThreadId; }

    [LibraryImport("kernel32.dll", EntryPoint = "CreateProcessW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CreateProcess(string? lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandles, int dwCreationFlags, IntPtr lpEnvironment, string? lpCurrentDirectory, ref StartupInfoEx lpStartupInfo, out ProcessInformation lpProcessInformation);

    private readonly Process _process;
    private readonly FileStream _ptyIn;     // 我们写入 → PTY 输入
    private readonly FileStream _ptyOut;    // PTY 输出 → 我们读取
    private IntPtr _ptyHandle;
    private readonly List<IntPtr> _ownedHandles = new();

    public ConPtyProcess(string command, string workingDirectory, int cols, int rows)
    {
        var (inRead, inWrite) = CreatePipeHandles();
        var (outRead, outWrite) = CreatePipeHandles();
        _ownedHandles.AddRange(new[] { inRead, inWrite, outRead, outWrite });

        _ptyIn = new FileStream(new SafeFileHandle(inWrite, ownsHandle: false), FileAccess.Write);
        _ptyOut = new FileStream(new SafeFileHandle(outRead, ownsHandle: false), FileAccess.Read);

        var hr = CreatePseudoConsole(new Coord { X = (short)cols, Y = (short)rows }, inRead, outWrite, 0, out var ptyHandle);
        _ptyHandle = ptyHandle;
        if (hr != 0 || _ptyHandle == IntPtr.Zero)
            throw new Win32Exception($"CreatePseudoConsole 失败（hr=0x{hr:X8}，Win32 错误 {Marshal.GetLastWin32Error()}）");

        var size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        var attrList = Marshal.AllocHGlobal(size);
        InitializeProcThreadAttributeList(attrList, 1, 0, ref size);
        UpdateProcThreadAttribute(attrList, 0, (IntPtr)ProcThreadAttributePseudoConsole, _ptyHandle, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero);

        var si = new StartupInfoEx { Cb = Marshal.SizeOf<StartupInfoEx>(), Flags = StartfUsestdhandles | ExtendedStartupinfoPresent, AttributeList = attrList };
        // 直接用整条命令行（CreateProcess 自行解析可执行名与参数），不再套 cmd.exe /c 避免嵌套引号问题
        var cmd = new StringBuilder(command);
        if (!CreateProcess(null, cmd.ToString(), IntPtr.Zero, IntPtr.Zero, false, ExtendedStartupinfoPresent, IntPtr.Zero, workingDirectory, ref si, out var pi))
            throw new Win32Exception($"ConPTY 进程启动失败（Win32 错误 {Marshal.GetLastWin32Error()}）");

        DeleteProcThreadAttributeList(attrList);
        Marshal.FreeHGlobal(attrList);
        // PTY 已持有 inRead/outWrite 的副本，关闭我们这一侧的句柄
        CloseHandle(inRead);
        CloseHandle(outWrite);
        _ownedHandles.Remove(inRead);
        _ownedHandles.Remove(outWrite);

        if (pi.ProcessId == 0) throw new Win32Exception("ConPTY 进程启动失败");
        _process = Process.GetProcessById(pi.ProcessId);
    }

    public async Task WriteAsync(string text, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        await _ptyIn.WriteAsync(bytes, ct);
        await _ptyIn.FlushAsync(ct);
    }

    public async IAsyncEnumerable<string> ReadAllAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        var buffer = new byte[4096];
        var decoder = Encoding.UTF8.GetDecoder();
        var charBuffer = new char[4096];
        while (!ct.IsCancellationRequested)
        {
            int read;
            try { read = await _ptyOut.ReadAsync(buffer, ct); }
            catch (OperationCanceledException) { break; }
            if (read <= 0) break;
            var chars = decoder.GetChars(buffer, 0, read, charBuffer, 0);
            if (chars > 0) yield return new string(charBuffer, 0, chars);
        }
    }

    public void Resize(int cols, int rows) => ResizePseudoConsole(_ptyHandle, new Coord { X = (short)cols, Y = (short)rows });

    public void Kill()
    {
        try { if (!_process.HasExited) _process.Kill(entireProcessTree: true); } catch { }
    }

    public void Dispose()
    {
        Kill();
        _process.Dispose();
        _ptyIn.Dispose();
        _ptyOut.Dispose();
        if (_ptyHandle != IntPtr.Zero) { ClosePseudoConsole(_ptyHandle); _ptyHandle = IntPtr.Zero; }
        foreach (var handle in _ownedHandles)
        {
            if (handle != IntPtr.Zero) CloseHandle(handle);
        }
        _ownedHandles.Clear();
    }

    /// <summary>创建匿名管道并返回 (读句柄, 写句柄)</summary>
    private static (IntPtr read, IntPtr write) CreatePipeHandles()
    {
        if (!CreatePipe(out var read, out var write, IntPtr.Zero, 0))
            throw new Win32Exception("CreatePipe 失败");
        return (read, write);
    }
}

/* ─────────────── Unix script 包装 PTY ─────────────── */

/// <summary>
/// Unix 伪终端：用 script 工具为命令分配 pty（本地 bash / macOS zsh / 远端 ssh -tt 通用）。
/// 尺寸调整通过向终端注入 stty 实现；管道读写使用普通 Process 管道。
/// </summary>
public class ScriptPtyProcess : IPtyProcess
{
    private readonly Process _process;
    private int _cols = 80;
    private int _rows = 24;

    /// <param name="innerCommand">pty 内运行的命令（本地 shell 或 ssh -tt ...）</param>
    public ScriptPtyProcess(string innerCommand, string workingDirectory)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "/bin/sh",
            // Linux(util-linux) 与 BSD(macOS) 的 script 参数不同：先试 GNU 形式，失败再由上层回退
            Arguments = $"-c \"exec script -qfc {Quote(innerCommand)} /dev/null\"",
            WorkingDirectory = Directory.Exists(workingDirectory) ? workingDirectory : "/",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = Encoding.UTF8,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            EnvironmentVariables = { ["TERM"] = "xterm-256color" },
        };
        _process = Process.Start(psi) ?? throw new InvalidOperationException("无法启动 script");
    }

    /// <summary>BSD/macOS 形式的 script</summary>
    public static ScriptPtyProcess CreateBsd(string innerCommand, string workingDirectory)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "/bin/sh",
            Arguments = $"-c \"exec script -q /dev/null {innerCommand}\"",
            WorkingDirectory = Directory.Exists(workingDirectory) ? workingDirectory : "/",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = Encoding.UTF8,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            EnvironmentVariables = { ["TERM"] = "xterm-256color" },
        };
        var process = Process.Start(psi) ?? throw new InvalidOperationException("无法启动 script");
        return new ScriptPtyProcess(process, 80, 24);
    }

    private ScriptPtyProcess(Process process, int cols, int rows)
    {
        _process = process;
        _cols = cols;
        _rows = rows;
    }

    public async Task WriteAsync(string text, CancellationToken ct)
    {
        await _process.StandardInput.WriteAsync(text.AsMemory(), ct);
        await _process.StandardInput.FlushAsync(ct);
    }

    public async IAsyncEnumerable<string> ReadAllAsync(CancellationToken ct)
    {
        await foreach (var chunk in PumpAsync(_process.StandardOutput.BaseStream, ct)) yield return chunk;
        await foreach (var chunk in PumpAsync(_process.StandardError.BaseStream, ct)) yield return chunk;
    }

    private static async IAsyncEnumerable<string> PumpAsync(Stream stream, CancellationToken ct)
    {
        var buffer = new byte[4096];
        var decoder = Encoding.UTF8.GetDecoder();
        var chars = new char[4096];
        while (!ct.IsCancellationRequested)
        {
            int read;
            try { read = await stream.ReadAsync(buffer, ct); }
            catch (OperationCanceledException) { break; }
            if (read <= 0) break;
            var n = decoder.GetChars(buffer, 0, read, chars, 0);
            if (n > 0) yield return new string(chars, 0, n);
        }
    }

    public void Resize(int cols, int rows)
    {
        if (cols == _cols && rows == _rows) return;
        _cols = cols;
        _rows = rows;
        // script 的 pty 尺寸不随管道变化，向 shell 注入 stty 同步尺寸（交互式程序的输入场景下有少量回显）
        _ = TryInjectAsync($"stty cols {cols} rows {rows}");
    }

    private async Task TryInjectAsync(string command)
    {
        try
        {
            await _process.StandardInput.WriteAsync(command + "\r\n");
            await _process.StandardInput.FlushAsync();
        }
        catch { /* 终端已退出时忽略 */ }
    }

    public void Kill()
    {
        try { if (!_process.HasExited) _process.Kill(entireProcessTree: true); } catch { }
    }

    public void Dispose()
    {
        Kill();
        _process.Dispose();
    }

    private static string Quote(string value) => "'" + value.Replace("'", "'\\''") + "'";
}
