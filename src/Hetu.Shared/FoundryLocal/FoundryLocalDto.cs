namespace Hetu.Shared.FoundryLocal;

/// <summary>
/// Foundry Local 运行时状态。Supported=false 表示当前平台根本不支持（非 Windows 或缺少原生库），
/// 此时其余字段无意义，UI 应把入口置灰。
/// </summary>
public class FoundryLocalStatusDto
{
    /// <summary>当前平台是否支持（原生库在位）</summary>
    public bool Supported { get; set; }
    /// <summary>不支持时的原因（后端已本地化）</summary>
    public string? UnsupportedReason { get; set; }
    /// <summary>本地 OpenAI 兼容服务是否在监听（SDK 运行时本身是否就绪另看目录能否拉取）</summary>
    public bool Running { get; set; }
    /// <summary>OpenAI 兼容端点（如 http://127.0.0.1:5272/v1），未就绪为 null</summary>
    public string? Endpoint { get; set; }
    /// <summary>当前生效的模型保存路径</summary>
    public string? ModelDir { get; set; }
    /// <summary>未配置时的默认保存路径（用于「恢复默认」）</summary>
    public string? DefaultModelDir { get; set; }
    /// <summary>
    /// 已保存但尚未生效的模型保存路径（改完路径后、重启前有值）；
    /// 与 <see cref="ModelDir"/> 相同时为 null。
    /// </summary>
    public string? PendingModelDir { get; set; }
    /// <summary>可用的执行提供程序；只有已注册的 EP 才会让对应设备的模型变体出现在目录里</summary>
    public List<FoundryLocalEpDto> ExecutionProviders { get; set; } = [];
    /// <summary>已加载（常驻内存）的模型数</summary>
    public int LoadedCount { get; set; }
    /// <summary>已下载（本地有缓存）的模型数</summary>
    public int CachedCount { get; set; }
    /// <summary>
    /// 修改了模型保存路径但尚未生效：SDK 的运行时是进程级单例，初始化后无法重建，
    /// 所以新路径要等 Hetu 重启后才会用上。UI 应据此提示用户。
    /// </summary>
    public bool RestartRequired { get; set; }
}

/// <summary>Foundry Local 目录中的一个模型</summary>
public class FoundryLocalModelDto
{
    public string Alias { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public string? Publisher { get; set; }
    public string? ModelType { get; set; }
    public string? Task { get; set; }
    public string? License { get; set; }
    public string? Uri { get; set; }
    /// <summary>模型体积（MB）</summary>
    public int? FileSizeMb { get; set; }
    public long? ContextLength { get; set; }
    public long? MaxOutputTokens { get; set; }
    public bool SupportsToolCalling { get; set; }
    public bool SupportsReasoning { get; set; }
    /// <summary>输入模态（逗号分隔，如 text,image）</summary>
    public string? InputModalities { get; set; }
    /// <summary>输出模态（逗号分隔）</summary>
    public string? OutputModalities { get; set; }
    /// <summary>目标设备（CPU / GPU / NPU），来自模型目录的 Runtime 信息</summary>
    public string? DeviceType { get; set; }
    /// <summary>执行提供程序（如 CPU / CUDA / WebGPU）</summary>
    public string? ExecutionProvider { get; set; }
    /// <summary>是否已下载到本地</summary>
    public bool IsCached { get; set; }
    /// <summary>是否已加载进内存</summary>
    public bool IsLoaded { get; set; }
    /// <summary>可选的量化/设备变体 alias 列表</summary>
    public List<string> Variants { get; set; } = [];
    /// <summary>该模型在 Hetu 里是否已注册为 Provider 模型（供 UI 显示「已加入」）</summary>
    public bool IsRegistered { get; set; }
}

/// <summary>执行提供程序（EP）：决定目录里会出现哪些设备（CPU/GPU/NPU）的模型变体</summary>
public class FoundryLocalEpDto
{
    /// <summary>SDK 给的 EP 名，如 MIGraphXExecutionProvider</summary>
    public string Name { get; set; } = string.Empty;
    /// <summary>归类后的设备类型：CPU / GPU / NPU / Unknown</summary>
    public string DeviceType { get; set; } = "Unknown";
    /// <summary>是否已注册；未注册时该设备的模型变体不会出现在目录里</summary>
    public bool IsRegistered { get; set; }
}

/// <summary>下载进度（SSE 推送）</summary>
public class FoundryLocalDownloadProgressDto
{
    public string Alias { get; set; } = string.Empty;
    /// <summary>百分比，0~100；未知进度时为 null</summary>
    public double? Progress { get; set; }
    /// <summary>queued / downloading / completed / failed / cancelled</summary>
    public string State { get; set; } = "queued";
    public string? Error { get; set; }
}

/// <summary>修改模型保存路径；传空表示恢复默认</summary>
public class UpdateFoundryLocalModelDirRequest
{
    public string? Path { get; set; }
}
