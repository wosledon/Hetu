namespace Hetu.Api.Services;

/// <summary>
/// 父进程看门狗：桌面外壳（Tauri）启动后端时会带上 <c>HETU_PARENT_PID</c>。
/// 外壳正常退出会 kill 掉后端，但被强杀（任务管理器 / 更新安装 / 崩溃）时后端会变成孤儿，
/// 继续占用端口，并锁住 <c>sqlite-vec\vec0.dll</c> 导致下次安装报
/// “Error opening file for writing”。这里检测父进程消失后自行优雅退出。
/// 未设置该环境变量（开发时手工启动）则不启用。
/// </summary>
public sealed class ParentProcessWatchdog : BackgroundService
{
    private const string ParentPidVariable = "HETU_PARENT_PID";
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);

    private readonly IHostApplicationLifetime _lifetime;
    private readonly ILogger<ParentProcessWatchdog> _logger;

    public ParentProcessWatchdog(IHostApplicationLifetime lifetime, ILogger<ParentProcessWatchdog> logger)
    {
        _lifetime = lifetime;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!int.TryParse(Environment.GetEnvironmentVariable(ParentPidVariable), out var parentPid) || parentPid <= 0)
            return;

        if (!IsAlive(parentPid))
        {
            _logger.LogWarning("[Watchdog] 父进程 {ParentPid} 已不存在，直接退出", parentPid);
            _lifetime.StopApplication();
            return;
        }

        using var timer = new PeriodicTimer(PollInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            if (IsAlive(parentPid)) continue;
            _logger.LogInformation("[Watchdog] 父进程 {ParentPid} 已退出，关闭后端", parentPid);
            _lifetime.StopApplication();
            return;
        }
    }

    private static bool IsAlive(int pid)
    {
        try
        {
            using var process = System.Diagnostics.Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return false;
        }
    }
}
