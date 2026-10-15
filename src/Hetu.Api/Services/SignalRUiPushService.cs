using Hetu.Api.Hubs;
using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.SignalR;

namespace Hetu.Api.Services;

/// <summary>基于 SignalR 的 UI 动作推送：广播给所有已连接的前端。</summary>
public class SignalRUiPushService : IUiPushService
{
    private readonly IHubContext<UiHub> _hubContext;

    public SignalRUiPushService(IHubContext<UiHub> hubContext) => _hubContext = hubContext;

    public Task PublishAsync(string type, object? payload, CancellationToken cancellationToken = default)
        => _hubContext.Clients.All.SendAsync("uiAction", new { type, payload }, cancellationToken);
}
