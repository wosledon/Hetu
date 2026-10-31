using Hetu.Shared.FoundryLocal;

namespace Hetu.Core.Interfaces;

/// <summary>
/// Foundry Local 本地模型运行时管理面。实现是 <c>foundry</c> CLI 的一层壳，
/// 对应 CLI 的 model / server / cache / config 四组命令。
/// </summary>
public interface IFoundryLocalService
{
    /// <summary>运行时状态：CLI 是否安装、服务是否在跑、端点、缓存目录、本机硬件摘要</summary>
    Task<FoundryLocalStatusDto> GetStatusAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 当前本地 OpenAI 兼容端点（如 http://127.0.0.1:62645）；服务未启动或平台不支持时为 null。
    /// 端口由 CLI 动态分配，调用方不要写死。
    /// </summary>
    Task<string?> GetEndpointAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 确保某个变体可用于推理：本地服务没起就拉起来，模型没加载就加载。
    /// </summary>
    Task EnsureLoadedAsync(string variantId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 模型目录。<c>--variants</c> 让 CLI 把同一模型的每个设备变体各出一行，
    /// 摊平后 GPU/NPU 变体不会再像硬件匹配模式下那样被藏起来。
    /// includeCachedOnly=true 时只返回本地已下载的变体（等价 <c>foundry cache list</c>）。
    /// </summary>
    Task<List<FoundryLocalModelDto>> GetModelsAsync(bool includeCachedOnly = false, CancellationToken cancellationToken = default);

    /// <summary>下载变体。进度经 progress 回调（0~100），大文件请放到后台任务里跑</summary>
    Task DownloadAsync(string variantId, IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    /// <summary>删除本地缓存（等价 <c>foundry cache remove</c>）</summary>
    Task RemoveFromCacheAsync(string variantId, CancellationToken cancellationToken = default);

    /// <summary>加载进内存（等价 <c>foundry model load</c>）</summary>
    Task LoadAsync(string variantId, CancellationToken cancellationToken = default);

    /// <summary>从内存卸载（等价 <c>foundry model unload</c>）</summary>
    Task UnloadAsync(string variantId, CancellationToken cancellationToken = default);

    /// <summary>当前已加载（常驻内存）的模型</summary>
    Task<List<FoundryLocalModelDto>> GetLoadedModelsAsync(CancellationToken cancellationToken = default);

    /// <summary>启动本地服务（等价 <c>foundry server start</c>）</summary>
    Task StartServiceAsync(CancellationToken cancellationToken = default);

    /// <summary>停止本地服务（等价 <c>foundry server stop</c>）</summary>
    Task StopServiceAsync(CancellationToken cancellationToken = default);

    /// <summary>重启本地服务（等价 <c>foundry server restart</c>）</summary>
    Task RestartServiceAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 设置模型缓存目录；传空或空白恢复默认。改的是 CLI 自己的持久配置，
    /// 立即生效，不需要重启 Hetu。
    /// </summary>
    Task<string> SetCacheDirAsync(string? path, CancellationToken cancellationToken = default);

    /// <summary>
    /// 把 Foundry Local 模型注册成 Hetu 的 Provider 模型，返回 AiModel Id。
    /// variantId 是变体 Id（如 Phi-4-mini-instruct-generic-gpu:5），本地端点按它寻址。
    /// purpose: chat / completion / embedding。
    /// </summary>
    Task<Guid> RegisterAsProviderModelAsync(string variantId, string purpose, CancellationToken cancellationToken = default);

    /// <summary>本地化的「当前平台不支持」原因；支持时返回 null</summary>
    string? GetUnsupportedReason();
}
