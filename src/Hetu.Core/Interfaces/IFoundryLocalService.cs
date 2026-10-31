using Hetu.Shared.FoundryLocal;

namespace Hetu.Core.Interfaces;

/// <summary>
/// Foundry Local 本地模型运行时管理面。对应 `foundry` CLI 的 model / service / cache 三组命令：
/// 目录浏览、下载、加载/卸载、缓存清理、Web 服务启停。
/// </summary>
public interface IFoundryLocalService
{
    /// <summary>运行时状态：平台支持性、端点、当前模型保存路径、已加载/已缓存数量</summary>
    Task<FoundryLocalStatusDto> GetStatusAsync(CancellationToken cancellationToken = default);
    /// <summary>
    /// 模型目录。同一模型按设备分多个变体，这里把变体摊平成一列——
    /// SDK 的 ListModelsAsync 只返回与当前硬件匹配的那一个，GPU/NPU 变体要按 Id 另取。
    /// includeCachedOnly=true 时只返回本地已下载的变体（等价 `foundry cache list`）。
    /// </summary>
    Task<List<FoundryLocalModelDto>> GetModelsAsync(bool includeCachedOnly = false, CancellationToken cancellationToken = default);

    /// <summary>下载变体。进度经 progress 回调（0~100），大文件请放到后台任务里跑</summary>
    Task DownloadAsync(string variantId, IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    /// <summary>删除本地缓存（等价 `foundry cache remove`）</summary>
    Task RemoveFromCacheAsync(string variantId, CancellationToken cancellationToken = default);

    /// <summary>加载进内存（等价 `foundry model load`）</summary>
    Task LoadAsync(string variantId, CancellationToken cancellationToken = default);

    /// <summary>从内存卸载（等价 `foundry model unload`）</summary>
    Task UnloadAsync(string variantId, CancellationToken cancellationToken = default);

    /// <summary>当前已加载（常驻内存）的模型</summary>
    Task<List<FoundryLocalModelDto>> GetLoadedModelsAsync(CancellationToken cancellationToken = default);

    /// <summary>启动 OpenAI 兼容 Web 服务（等价 `foundry service start`）</summary>
    Task StartServiceAsync(CancellationToken cancellationToken = default);

    /// <summary>停止 Web 服务（等价 `foundry service stop`）</summary>
    Task StopServiceAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 设置模型保存路径；传空或空白恢复默认。改的是 <c>Configuration.ModelCacheDir</c>，
    /// 该值在运行时初始化时就固定了，所以改完必须重建运行时才生效。
    /// </summary>
    Task<string> SetModelDirAsync(string? path, CancellationToken cancellationToken = default);

    /// <summary>恢复默认保存路径</summary>
    Task<string> ResetModelDirAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 把 Foundry Local 模型注册成 Hetu 的 Provider 模型，返回 AiModel Id。
    /// variantId 是变体 Id（如 Phi-4-mini-instruct-generic-gpu:5），本地端点按它寻址。
    /// purpose: chat / completion / embedding。
    /// </summary>
    Task<Guid> RegisterAsProviderModelAsync(string variantId, string purpose, CancellationToken cancellationToken = default);

    /// <summary>可用的执行提供程序（CPU/GPU/NPU 后端）及其注册状态</summary>
    Task<List<FoundryLocalEpDto>> GetExecutionProvidersAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 下载并注册执行提供程序。注册后本地运行时需要重建才会按新 EP 过滤目录，
    /// 因此和改模型路径一样要重启 Hetu 才生效。
    /// </summary>
    Task DownloadAndRegisterExecutionProvidersAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    /// <summary>本地化的「当前平台不支持」原因；支持时返回 null</summary>
    string? GetUnsupportedReason();
}
