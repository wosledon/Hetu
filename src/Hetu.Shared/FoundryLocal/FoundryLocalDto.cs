namespace Hetu.Shared.FoundryLocal;

/// <summary>
/// Foundry Local 运行时状态。整个模块是 <c>foundry</c> CLI 的一层壳，
/// 所以第一道判断是「CLI 装没装」——没装时页面展示安装引导，其余字段无意义。
/// </summary>
public class FoundryLocalStatusDto
{
    /// <summary>是否找得到 foundry CLI；false 时 UI 应展示安装引导</summary>
    public bool CliInstalled { get; set; }
    /// <summary>CLI 版本（如 0.12.1）</summary>
    public string? CliVersion { get; set; }
    /// <summary>当前平台是否支持运行本地模型（CLI 只在 Windows 上提供）</summary>
    public bool Supported { get; set; }
    /// <summary>不支持时的原因（后端已本地化）</summary>
    public string? UnsupportedReason { get; set; }
    /// <summary>本地 OpenAI 兼容服务是否在跑</summary>
    public bool Running { get; set; }
    /// <summary>OpenAI 兼容端点（如 http://127.0.0.1:62645），未就绪为 null</summary>
    public string? Endpoint { get; set; }
    /// <summary>模型缓存目录</summary>
    public string? CacheDir { get; set; }
    /// <summary>本机 GPU 摘要（用于状态卡展示，如 "AMD Radeon RX 9070 XT"）</summary>
    public List<string> Gpus { get; set; } = [];
    /// <summary>本机 NPU 摘要</summary>
    public List<string> Npus { get; set; } = [];
    /// <summary>CPU 型号</summary>
    public string? Cpu { get; set; }
    /// <summary>可用内存（字节）</summary>
    public long? AvailableMemoryBytes { get; set; }
    /// <summary>磁盘剩余空间（字节）</summary>
    public long? DiskFreeBytes { get; set; }
    /// <summary>目录里的模型总数</summary>
    public int AvailableCount { get; set; }
    /// <summary>已加载（常驻内存）的模型数</summary>
    public int LoadedCount { get; set; }
    /// <summary>已下载（本地有缓存）的模型数</summary>
    public int CachedCount { get; set; }
    /// <summary>CLI 自己给出的警告（如某个 EP 注册失败）</summary>
    public List<string> Warnings { get; set; } = [];
}

/// <summary>Foundry Local 目录中的一个模型变体（同一模型按设备分多个变体）</summary>
public class FoundryLocalModelDto
{
    /// <summary>模型别名（人看的那个，如 phi-4-mini）</summary>
    public string Alias { get; set; } = string.Empty;
    /// <summary>变体 Id（CLI 与本地端点都用它寻址，如 Phi-4-mini-instruct-generic-gpu:5）</summary>
    public string Id { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public string? Publisher { get; set; }
    /// <summary>来源：Public / Local（本地注册的）</summary>
    public string? Source { get; set; }
    /// <summary>任务类型：Chat / Embedding / Speech / Multimodal</summary>
    public string? Task { get; set; }
    public string? License { get; set; }
    /// <summary>模型体积（MB）</summary>
    public int? FileSizeMb { get; set; }
    /// <summary>该变体的目标设备：CPU / GPU / NPU</summary>
    public string? DeviceType { get; set; }
    /// <summary>该变体的执行提供程序（如 CPU / WebGPU / CUDA）</summary>
    public string? ExecutionProvider { get; set; }
    /// <summary>是否已下载到本地</summary>
    public bool IsCached { get; set; }
    /// <summary>是否已加载进内存</summary>
    public bool IsLoaded { get; set; }
    /// <summary>该模型还有哪些设备的变体（用于行内展示「GPU · CPU」）</summary>
    public List<string> DeviceVariants { get; set; } = [];
    /// <summary>该模型在 Hetu 里是否已注册为 Provider 模型（供 UI 显示「已加入」）</summary>
    public bool IsRegistered { get; set; }
}

/// <summary>下载进度（SSE 推送）</summary>
public class FoundryLocalDownloadProgressDto
{
    public string Alias { get; set; } = string.Empty;
    /// <summary>百分比，0~100；CLI 没吐进度时为 null</summary>
    public double? Progress { get; set; }
    /// <summary>queued / downloading / completed / failed / cancelled</summary>
    public string State { get; set; } = "queued";
    public string? Error { get; set; }
}

/// <summary>设置模型缓存目录；传空表示恢复默认</summary>
public class UpdateFoundryLocalCacheDirRequest
{
    public string? Path { get; set; }
}
