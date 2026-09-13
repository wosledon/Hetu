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

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .MinimumLevel.Override("Microsoft", LogEventLevel.Information)
            .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .WriteTo.Console()
            .WriteTo.File(
                Path.Combine(logDirectory, "hetu-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: RetainedFileCount)
            .CreateLogger();
    }
}
