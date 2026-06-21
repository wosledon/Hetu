using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Background;

public class AutoOrganizeService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AutoOrganizeService> _logger;
    private const int MessageThreshold = 20;

    public AutoOrganizeService(IServiceScopeFactory scopeFactory, ILogger<AutoOrganizeService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("自动整理服务已启动");

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await CheckAndOrganizeAsync(stoppingToken);
        }
    }

    private async Task CheckAndOrganizeAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
            var organizeService = scope.ServiceProvider.GetRequiredService<IChatOrganizeService>();

            var allTopics = await unitOfWork.ChatTopics.GetAllAsync(cancellationToken);
            var autoOrganizeTopics = allTopics
                .Where(t => t.IsAutoOrganizeEnabled)
                .ToList();

            foreach (var topic in autoOrganizeTopics)
            {
                var messages = await unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topic.Id, cancellationToken);
                if (messages.Count < MessageThreshold) continue;

                var notebookId = topic.AutoOrganizeNotebookId;
                var request = new OrganizeTopicRequest
                {
                    NotebookId = notebookId,
                    Style = "summary"
                };

                var organized = false;
                await foreach (var delta in organizeService.OrganizeTopicAsync(topic.Id, request, cancellationToken))
                {
                    if (delta.StartsWith("[DONE]"))
                    {
                        organized = true;
                        _logger.LogInformation("自动整理话题 {TopicId} 成功，笔记 ID: {NoteId}", topic.Id, delta[6..]);
                    }
                    else if (delta.StartsWith("[ERROR]"))
                    {
                        _logger.LogWarning("自动整理话题 {TopicId} 失败: {Error}", topic.Id, delta);
                    }
                }

                if (organized)
                {
                    topic.IsAutoOrganizeEnabled = false;
                    await unitOfWork.ChatTopics.UpdateAsync(topic, cancellationToken);
                    await unitOfWork.SaveChangesAsync(cancellationToken);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "自动整理检查失败");
        }
    }
}
