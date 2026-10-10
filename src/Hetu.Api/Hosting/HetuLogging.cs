using Serilog;
using Serilog.Events;

namespace Hetu.Api.Hosting;

/// <summary>Serilog 全局日志配置：控制台 + 按天滚动的文件（保留 7 天）。</summary>
public static class HetuLogging
{
    private const int RetainedFileCount = 7;

    public static void Configure(string dataDir)
    {
        var logDirectory = Path.Combine(dataDir, "logs");
        Directory.CreateDirectory(logDirectory);

        // Serilog 的文件 sink 默认静默失败（打不开文件时整进程都不落盘，控制台却照常打印），
        // 这里把内部错误打到 stderr，避免「日志文件突然不长了」查不出原因
        Serilog.Debugging.SelfLog.Enable(msg => Console.Error.WriteLine($"[Serilog] {msg}"));

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .MinimumLevel.Override("Microsoft", LogEventLevel.Information)
            .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .WriteTo.Console()
            .WriteTo.File(
                Path.Combine(logDirectory, "hetu-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: RetainedFileCount,
                // 共享写：dev 后端与桌面壳（或两个实例）同时运行时不会互相抢文件导致一方彻底不落盘
                shared: true)
            .CreateLogger();
    }
}
