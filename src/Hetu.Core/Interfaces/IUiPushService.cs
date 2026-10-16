namespace Hetu.Core.Interfaces;

/// <summary>
/// 向已连接的前端主动推送 UI 动作（SignalR 通道）。
/// 与 SSE 流不同：不依赖前端发起的请求，后端在任意时刻都能触发界面行为（如唤起面板）。
/// </summary>
public interface IUiPushService
{
    /// <summary>广播一个 UI 动作：type 为动作名（open_panel=唤起工作台面板 / navigate=跳转应用页面 / notify=全局通知），payload 为附加数据</summary>
    Task PublishAsync(string type, object? payload, CancellationToken cancellationToken = default);
}
