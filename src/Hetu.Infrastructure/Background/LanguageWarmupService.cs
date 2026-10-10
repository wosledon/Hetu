using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

/// <summary>
/// 启动时把应用设置里的 Language 灌进进程内偏好：
/// 后台任务（Dream、定时任务等）没有请求头，靠这个值决定输出语言。
/// </summary>
public class LanguageWarmupService : IHostedService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILanguagePreference _preference;
    private readonly ILogger<LanguageWarmupService> _logger;

    public LanguageWarmupService(
        IServiceScopeFactory scopeFactory,
        ILanguagePreference preference,
        ILogger<LanguageWarmupService> logger)
    {
        _scopeFactory = scopeFactory;
        _preference = preference;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var settings = scope.ServiceProvider.GetRequiredService<IAppSettingService>();
            var result = await settings.GetAsync("Language", cancellationToken);
            var value = result.Data?.Value;
            if (!string.IsNullOrWhiteSpace(value)) _preference.Language = value;
        }
        catch (Exception ex)
        {
            // 数据库尚未就绪时保留默认语言即可，不影响启动
            _logger.LogWarning(ex, "[i18n] 读取语言设置失败，使用默认值 {Language}", _preference.Language);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
