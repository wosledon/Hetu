using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Hetu.Infrastructure.FoundryLocal;

/// <summary>
/// <c>foundry</c> CLI 的薄封装：定位可执行文件、执行命令、解析 JSON 输出。
///
/// 为什么走 CLI 而不是进程内 SDK：SDK 带 38MB 原生库，与单文件发布
/// （PublishSingleFile + IncludeNativeLibrariesForSelfExtract）互相打架，
/// 安装包里必然缺文件。CLI 由用户自行安装（winget），Hetu 只负责调它，
/// 打包体积和原生库兼容性都不再是 Hetu 的问题。
/// </summary>
public static class FoundryLocalCli
{
    /// <summary>PATH 里找不到时的常见安装位置（winget 装的是 WindowsApps 垫片）</summary>
    private static readonly string[] KnownLocations =
    [
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "foundry.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "FoundryLocal", "foundry.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Foundry Local", "foundry.exe"),
    ];

    /// <summary>CLI 是外部进程，真卡住时不能把请求一起拖死</summary>
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromMinutes(10);

    /// <summary>是否找得到 CLI。找不到时页面应展示安装引导，而不是报错</summary>
    public static bool IsInstalled() => ResolveExecutable() != null;

    /// <summary>CLI 可执行文件路径；找不到返回 null</summary>
    public static string? ResolveExecutable()
    {
        foreach (var candidate in KnownLocations)
            if (File.Exists(candidate)) return candidate;

        var pathVariable = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(pathVariable)) return null;

        foreach (var dir in pathVariable.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try
            {
                var candidate = Path.Combine(dir, "foundry.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch (IOException)
            {
                // PATH 里可能有非法目录项，跳过即可
            }
            catch (ArgumentException)
            {
            }
        }
        return null;
    }

    /// <summary>
    /// 执行命令并把 stdout 解析成 JSON。CLI 的错误统一走
    /// <c>{"error":{"code","message","hint"}}</c>，这里转成 <see cref="FoundryLocalCliException"/>
    /// 让上层直接拿到人话，不用各自解析。
    /// </summary>
    public static async Task<JsonElement> RunJsonAsync(
        string arguments,
        CancellationToken cancellationToken = default,
        TimeSpan? timeout = null)
    {
        var (stdout, stderr, exitCode) = await RunAsync(arguments, timeout, cancellationToken);
        var text = stdout.ToString().Trim();
        if (text.Length == 0)
            throw new FoundryLocalCliException(stderr.Length > 0 ? stderr.ToString().Trim() : "foundry CLI 无输出", exitCode);

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(text);
        }
        catch (JsonException ex)
        {
            throw new FoundryLocalCliException($"foundry CLI 输出不是合法 JSON：{ex.Message}", exitCode);
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.Object)
            {
                var message = error.TryGetProperty("message", out var m) ? m.GetString() : null;
                var hint = error.TryGetProperty("hint", out var h) ? h.GetString() : null;
                var detail = string.IsNullOrWhiteSpace(message) ? "foundry CLI 报错" : message;
                if (!string.IsNullOrWhiteSpace(hint)) detail = $"{detail}（{hint}）";
                throw new FoundryLocalCliException(detail, exitCode);
            }

            return root.Clone();
        }
    }

    /// <summary>
    /// 执行命令并逐行消费 stdout，返回退出码。下载进度只有 text 模式才输出
    /// （<c>&lt;variant&gt;: 42%</c>），所以这条路径不能加 <c>-o json</c>。
    /// </summary>
    public static async Task<int> RunStreamingAsync(
        string arguments,
        Func<string, Task>? onLine,
        CancellationToken cancellationToken = default,
        TimeSpan? timeout = null)
    {
        var executable = ResolveExecutable()
            ?? throw new FoundryLocalCliException("未找到 foundry CLI", -1);

        using var process = new Process();
        var info = new ProcessStartInfo
        {
            FileName = executable,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        process.StartInfo = info;
        if (!process.Start()) throw new FoundryLocalCliException("foundry CLI 启动失败", -1);

        var stderr = new StringBuilder();
        var stderrTask = Task.Run(async () =>
        {
            var line = await process.StandardError.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            while (line != null)
            {
                lock (stderr) stderr.AppendLine(line);
                line = await process.StandardError.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            }
        }, cancellationToken);

        // 逐字符扫：CLI 的进度用 \r 刷新，只按行读会丢掉中间态
        var buffer = new StringBuilder();
        var stdout = process.StandardOutput.BaseStream;
        var readBuffer = new byte[4096];
        while (true)
        {
            var read = await stdout.ReadAsync(readBuffer, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            foreach (var ch in Encoding.UTF8.GetChars(readBuffer, 0, read))
            {
                if (ch is '\r' or '\n')
                {
                    var line = buffer.ToString();
                    buffer.Clear();
                    if (line.Trim().Length > 0 && onLine != null) await onLine(line);
                }
                else
                {
                    buffer.Append(ch);
                }
            }
        }
        var tail = buffer.ToString();
        if (tail.Trim().Length > 0 && onLine != null) await onLine(tail);

        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        await stderrTask.ConfigureAwait(false);
        return process.ExitCode;
    }

    /// <summary>
    /// 从下载输出行里解析进度。CLI 形如 <c>qwen3-0.6b-generic-cpu:4: 42%</c>，
    /// 也可能混进「Downloading model (...)」这类信息行，解析不了就当没进度。
    /// </summary>
    public static double? ParseDownloadProgress(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        var separator = line.LastIndexOf(':');
        if (separator < 0 || separator == line.Length - 1) return null;

        var tail = line[(separator + 1)..].Trim();
        if (!tail.EndsWith('%')) return null;

        var number = tail[..^1].Trim();
        return double.TryParse(number, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var percent)
            ? Math.Clamp(percent, 0, 100)
            : null;
    }

    private static async Task<(StringBuilder Stdout, StringBuilder Stderr, int ExitCode)> RunAsync(
        string arguments,
        TimeSpan? timeout,
        CancellationToken cancellationToken)
    {
        var executable = ResolveExecutable()
            ?? throw new FoundryLocalCliException("未找到 foundry CLI", -1);

        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = executable,
            // -o json 让所有命令输出结构化数据，text 模式那是给人看的
            Arguments = $"-o json {arguments}",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        if (!process.Start()) throw new FoundryLocalCliException("foundry CLI 启动失败", -1);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeout ?? DefaultTimeout);

        var stdout = await process.StandardOutput.ReadToEndAsync(cts.Token).ConfigureAwait(false);
        var stderr = await process.StandardError.ReadToEndAsync(cts.Token).ConfigureAwait(false);
        await process.WaitForExitAsync(cts.Token).ConfigureAwait(false);

        return (new StringBuilder(stdout), new StringBuilder(stderr), process.ExitCode);
    }
}

/// <summary>CLI 执行失败：消息已整理成可直接展示给用户的形式</summary>
public sealed class FoundryLocalCliException : Exception
{
    public int ExitCode { get; }

    public FoundryLocalCliException(string message, int exitCode) : base(message) => ExitCode = exitCode;
}
