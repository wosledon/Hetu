using Microsoft.AspNetCore.SignalR;

namespace Hetu.Api.Hubs;

/// <summary>
/// 前端 UI 动作推送通道：后端通过它主动触发前端（打开面板等），前端连接后被动接收。
/// </summary>
public class UiHub : Hub
{
}
