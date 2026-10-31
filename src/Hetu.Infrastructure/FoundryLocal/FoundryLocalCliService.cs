using System.Globalization;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.FoundryLocal;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.FoundryLocal;

/// <summary>
/// Foundry Local 管理面，全部通过壳调用 <c>foundry</c> CLI 实现。
///
/// 三条约束：
/// 1) CLI 没装就什么都不做：<see cref="IsSupported"/> 恒 false，页面据此展示安装引导，
///    而不是把「找不到 foundry.exe」这种原始错误抛给用户。
/// 2) 服务商/模型仓储是 scoped，而本服务是单例，所以按需开子作用域拿它们。
/// 3) 并发要串：CLI 是外部进程，同时下两个模型会互相抢缓存锁。
/// </summary>
public class FoundryLocalCliService : IFoundryLocalService
{
    /// <summary>CLI 只在 Windows 上发布；别的平台直接告知不支持</summary>
    private static readonly bool IsWindows = OperatingSystem.IsWindows();

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILocalizer _localizer;
    private readonly ILogger<FoundryLocalCliService> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>CLI 是否装了的探测结果缓存：装/没装不会在进程生命周期里变</summary>
    private bool? _cliInstalled;
    private string? _unsupportedReason;

    public FoundryLocalCliService(
        IServiceScopeFactory scopeFactory,
        ILocalizer localizer,
        ILogger<FoundryLocalCliService> logger)
    {
        _scopeFactory = scopeFactory;
        _localizer = localizer;
        _logger = logger;
    }

    public string? GetUnsupportedReason()
    {
        EnsureSupportedChecked();
        return _unsupportedReason;
    }

    private bool IsSupported()
    {
        EnsureSupportedChecked();
        return _unsupportedReason == null;
    }

    /// <summary>只探测一次。放在首次调用而不是构造函数里：构造时探测会让整个 DI 图在启动时多跑一次文件系统</summary>
    private void EnsureSupportedChecked()
    {
        if (_unsupportedReason != null) return;

        if (!IsWindows)
        {
            _unsupportedReason = _localizer.T("foundry.windowsOnly");
            return;
        }

        _cliInstalled = FoundryLocalCli.IsInstalled();
        if (!_cliInstalled.Value)
            _unsupportedReason = _localizer.T("foundry.cliNotInstalled");
    }

    public async Task<FoundryLocalStatusDto> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var dto = new FoundryLocalStatusDto();
        if (!IsSupported()) return dto;

        try
        {
            await _gate.WaitAsync(cancellationToken);
            var status = await FoundryLocalCli.RunJsonAsync("status", cancellationToken);
            ApplyStatus(dto, status);

            var cache = await FoundryLocalCli.RunJsonAsync("cache location", cancellationToken);
            dto.CacheDir = cache.TryGetProperty("path", out var path) ? path.GetString() : null;
        }
        catch (FoundryLocalCliException ex)
        {
            _logger.LogWarning(ex, "读取 Foundry Local 状态失败");
            dto.Warnings.Add(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "读取 Foundry Local 状态失败");
            dto.Warnings.Add(ex.Message);
        }
        finally
        {
            _gate.Release();
        }
        return dto;
    }

    private static void ApplyStatus(FoundryLocalStatusDto dto, JsonElement status)
    {
        dto.CliInstalled = true;

        if (status.TryGetProperty("system", out var system))
        {
            dto.Cpu = GetString(system, "cpu");
            dto.AvailableMemoryBytes = GetLong(system, "availableMemoryBytes");
            dto.DiskFreeBytes = GetLong(system, "diskFreeBytes");
            // CLI 按适配器枚举，同一张独显会重复出现三次；按名称去重，保留首条（带显存那条）
            dto.Gpus = ReadDevices(system, "gpus");
            dto.Npus = ReadDevices(system, "npus");
        }

        if (status.TryGetProperty("service", out var service))
        {
            dto.CliVersion = GetString(service, "cliVersion");
            dto.Running = GetBool(service, "ready");
            var urls = ReadStrings(service, "webUrls", null);
            dto.Endpoint = urls.Count > 0 ? urls[0] : null;
        }

        if (status.TryGetProperty("models", out var models))
        {
            dto.AvailableCount = (int)(GetLong(models, "available") ?? 0);
            dto.LoadedCount = (int)(GetLong(models, "loaded") ?? 0);
            dto.CachedCount = (int)(GetLong(models, "cached") ?? 0);
        }

        dto.Warnings = ReadStrings(status, "warnings", null);
        dto.Supported = true;
    }

    public async Task<string?> GetEndpointAsync(CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) return null;
        var status = await GetStatusAsync(cancellationToken);
        if (!status.Running || string.IsNullOrWhiteSpace(status.Endpoint)) return null;

        // CLI 的 webUrls 给的是 http://127.0.0.1:62645 这种根地址，
        // 而 OpenAI 客户端要拼 /v1；用户手填了带 /v1 的则原样尊重
        var trimmed = status.Endpoint.TrimEnd('/');
        return trimmed.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? trimmed : $"{trimmed}/v1";
    }

    public async Task EnsureLoadedAsync(string variantId, CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) return;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            // 服务没起就先拉起来：CLI 的 model load 会自动起 daemon，但显式一次
            // 能让「服务没启动」和「模型加载失败」两种错误分开报
            var server = await FoundryLocalCli.RunJsonAsync("server status", cancellationToken);
            if (!GetBool(server, "running"))
                await FoundryLocalCli.RunJsonAsync("server start", cancellationToken);

            var loaded = await FoundryLocalCli.RunJsonAsync("model list --loaded", cancellationToken);
            foreach (var model in Enumerate(loaded, "models"))
            {
                if (string.Equals(GetString(model, "id"), variantId, StringComparison.OrdinalIgnoreCase))
                    return;
            }

            await FoundryLocalCli.RunJsonAsync($"model load {Quote(variantId)}", cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<List<FoundryLocalModelDto>> GetModelsAsync(
        bool includeCachedOnly = false,
        CancellationToken cancellationToken = default)
    {
        var empty = new List<FoundryLocalModelDto>();
        if (!IsSupported()) return empty;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            // --variants 让 CLI 把每个设备变体各出一行，GPU/NPU 变体不会被硬件匹配藏掉
            var args = includeCachedOnly ? "cache list" : "model list --variants";
            var root = await FoundryLocalCli.RunJsonAsync(args, cancellationToken);

            var rows = new List<FoundryLocalModelDto>();
            var devicesByAlias = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

            foreach (var item in EnumerateModels(root))
            {
                var alias = GetString(item, "alias") ?? string.Empty;
                var device = NormalizeDevice(GetString(item, "device"));
                if (device != null && alias.Length > 0)
                {
                    if (!devicesByAlias.TryGetValue(alias, out var set))
                    {
                        set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        devicesByAlias[alias] = set;
                    }
                    set.Add(device);
                }

                rows.Add(new FoundryLocalModelDto
                {
                    Alias = alias,
                    Id = GetString(item, "id") ?? GetString(item, "variantId") ?? string.Empty,
                    DisplayName = GetString(item, "displayName") ?? GetString(item, "variantName"),
                    Source = GetString(item, "source"),
                    Task = GetString(item, "type"),
                    License = GetString(item, "license"),
                    FileSizeMb = (int?)GetLong(item, "fileSizeMb"),
                    DeviceType = device,
                    ExecutionProvider = NormalizeEp(GetString(item, "executionProvider")),
                    IsCached = GetBool(item, "cached"),
                    IsLoaded = GetBool(item, "loaded"),
                });
            }

            var registered = await GetRegisteredModelIdsAsync(cancellationToken);
            foreach (var row in rows)
            {
                row.DeviceVariants = devicesByAlias.TryGetValue(row.Alias, out var set)
                    ? set.OrderBy(d => d, StringComparer.Ordinal).ToList()
                    : [];
                row.IsRegistered = registered.Contains(row.Id);
            }

            // 已下载的排前面，再按名字、设备，方便直接找到能用的
            return rows
                .OrderByDescending(m => m.IsCached)
                .ThenBy(m => m.DisplayName ?? m.Alias, StringComparer.OrdinalIgnoreCase)
                .ThenBy(m => m.DeviceType, StringComparer.Ordinal)
                .ToList();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task DownloadAsync(
        string variantId,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            // 进度只有 text 模式才吐（`<variant>: 42%`），所以这里不能加 -o json
            var exitCode = await FoundryLocalCli.RunStreamingAsync(
                $"model download {Quote(variantId)}",
                line =>
                {
                    var percent = FoundryLocalCli.ParseDownloadProgress(line);
                    if (percent.HasValue) progress?.Report(percent.Value);
                    return Task.CompletedTask;
                },
                cancellationToken);

            if (exitCode != 0)
                throw new InvalidOperationException(_localizer.T("foundry.downloadFailed", variantId, exitCode));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RemoveFromCacheAsync(string variantId, CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await FoundryLocalCli.RunJsonAsync($"cache remove {Quote(variantId)}", cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task LoadAsync(string variantId, CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await FoundryLocalCli.RunJsonAsync($"model load {Quote(variantId)}", cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task UnloadAsync(string variantId, CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await FoundryLocalCli.RunJsonAsync($"model unload {Quote(variantId)}", cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<List<FoundryLocalModelDto>> GetLoadedModelsAsync(CancellationToken cancellationToken = default)
    {
        var empty = new List<FoundryLocalModelDto>();
        if (!IsSupported()) return empty;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var root = await FoundryLocalCli.RunJsonAsync("model list --loaded", cancellationToken);
            var registered = await GetRegisteredModelIdsAsync(cancellationToken);
            var rows = new List<FoundryLocalModelDto>();
            foreach (var item in Enumerate(root, "models"))
            {
                var id = GetString(item, "id") ?? string.Empty;
                rows.Add(new FoundryLocalModelDto
                {
                    Alias = GetString(item, "alias") ?? string.Empty,
                    Id = id,
                    DisplayName = GetString(item, "displayName"),
                    Source = GetString(item, "source"),
                    Task = GetString(item, "type"),
                    License = GetString(item, "license"),
                    FileSizeMb = (int?)GetLong(item, "fileSizeMb"),
                    DeviceType = NormalizeDevice(GetString(item, "device")),
                    ExecutionProvider = NormalizeEp(GetString(item, "executionProvider")),
                    IsCached = GetBool(item, "cached"),
                    IsLoaded = true,
                    IsRegistered = registered.Contains(id),
                });
            }
            return rows;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StartServiceAsync(CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await FoundryLocalCli.RunJsonAsync("server start", cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopServiceAsync(CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await FoundryLocalCli.RunJsonAsync("server stop", cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RestartServiceAsync(CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await FoundryLocalCli.RunJsonAsync("server restart", cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<string> SetCacheDirAsync(string? path, CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (string.IsNullOrWhiteSpace(path))
                await FoundryLocalCli.RunJsonAsync("config reset cache-directory", cancellationToken);
            else
                await FoundryLocalCli.RunJsonAsync($"config set cache-directory {Quote(path.Trim())}", cancellationToken);

            var cache = await FoundryLocalCli.RunJsonAsync("cache location", cancellationToken);
            return GetString(cache, "path") ?? string.Empty;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<Guid> RegisterAsProviderModelAsync(string variantId, string purpose, CancellationToken cancellationToken = default)
    {
        if (!IsSupported()) throw new InvalidOperationException(GetUnsupportedReason());

        var model = (await GetModelsAsync(false, cancellationToken))
            .FirstOrDefault(m => string.Equals(m.Id, variantId, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException(_localizer.T("foundry.modelNotFound", variantId));

        var providerId = await WithScopedServicesAsync(async (_, providers, _) =>
        {
            var existing = (await providers.GetAllAsync(cancellationToken)).Data?.FirstOrDefault(p =>
                string.Equals(p.ProviderType, "foundry", StringComparison.OrdinalIgnoreCase));
            if (existing != null) return existing.Id;

            var created = (await providers.CreateAsync(new CreateAiProviderRequest
            {
                ProviderType = "foundry",
                Name = "Foundry Local",
                IsEnabled = true,
            }, cancellationToken)).Data;
            return created?.Id ?? throw new InvalidOperationException(_localizer.T("foundry.registerFailed", "provider"));
        }, cancellationToken);

        var aiModelId = await WithScopedServicesAsync(async (_, _, models) =>
        {
            // ModelId 用变体 Id：本地端点按它寻址，注册哪个变体就跑哪个
            var created = await models.CreateAsync(new CreateAiModelRequest
            {
                ProviderId = providerId,
                ModelId = model.Id,
                DisplayName = $"{model.DisplayName ?? model.Alias} ({model.DeviceType ?? "—"})",
                Purpose = purpose,
                SupportsTools = false,
            }, cancellationToken);
            return created.Data?.Id ?? throw new InvalidOperationException(_localizer.T("foundry.registerFailed", variantId));
        }, cancellationToken);

        return aiModelId;
    }

    /// <summary>已注册成 Provider 模型的变体 Id 集合，用于行内「已加入」标记</summary>
    private async Task<HashSet<string>> GetRegisteredModelIdsAsync(CancellationToken cancellationToken)
        => await WithScopedServicesAsync(async (_, providers, models) =>
        {
            var providerIds = (await providers.GetAllAsync(cancellationToken)).Data?
                .Where(p => string.Equals(p.ProviderType, "foundry", StringComparison.OrdinalIgnoreCase))
                .Select(p => p.Id)
                .ToList() ?? [];

            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var providerId in providerIds)
            {
                var list = (await models.GetByProviderAsync(providerId, cancellationToken)).Data;
                if (list == null) continue;
                foreach (var m in list) result.Add(m.ModelId);
            }
            return result;
        }, cancellationToken);

    /// <summary>
    /// 本服务是单例（内部要共享 CLI 门禁），而设置/服务商/模型服务都是 scoped，
    /// 所以按需开一个子作用域来拿它们，不能直接注入。
    /// </summary>
    private async Task<T> WithScopedServicesAsync<T>(
        Func<IAppSettingService, IAiProviderService, IAiModelService, Task<T>> work,
        CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        // work 只吃三个服务，CancellationToken 由闭包捕获——委托签名带上它反而难读
        return await work(
            scope.ServiceProvider.GetRequiredService<IAppSettingService>(),
            scope.ServiceProvider.GetRequiredService<IAiProviderService>(),
            scope.ServiceProvider.GetRequiredService<IAiModelService>());
    }

    private static IEnumerable<JsonElement> Enumerate(JsonElement root, string property)
    {
        if (root.ValueKind != JsonValueKind.Object) yield break;
        if (!root.TryGetProperty(property, out var array) || array.ValueKind != JsonValueKind.Array) yield break;
        foreach (var item in array.EnumerateArray()) yield return item;
    }

    /// <summary>
    /// CLI 的模型列表有两种形状，字段名不一样：
    /// <c>model list</c> / <c>cache list</c> 给 <c>models</c>（id / displayName），
    /// <c>model list --variants</c> 给 <c>variants</c>（variantId / variantName）。
    /// 两种都要认，否则换条命令就拉不到数据。
    /// </summary>
    private static IEnumerable<JsonElement> EnumerateModels(JsonElement root)
    {
        foreach (var item in Enumerate(root, "models")) yield return item;
        foreach (var item in Enumerate(root, "variants")) yield return item;
    }

    private static string? GetString(JsonElement element, string property)
        => element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static long? GetLong(JsonElement element, string property)
        => element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt64(out var number)
                ? number
                : null;

    private static bool GetBool(JsonElement element, string property)
        => element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;

    private static List<string> ReadStrings(JsonElement element, string property, string? nested)
    {
        var result = new List<string>();
        if (!element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Array) return result;

        foreach (var item in value.EnumerateArray())
        {
            if (nested == null)
            {
                if (item.ValueKind == JsonValueKind.String) result.Add(item.GetString() ?? string.Empty);
            }
            else if (item.ValueKind == JsonValueKind.Object)
            {
                var inner = GetString(item, nested);
                if (!string.IsNullOrWhiteSpace(inner)) result.Add(inner);
            }
        }
        return result;
    }

    /// <summary>
    /// 读 GPU / NPU 列表并按名称去重。CLI 按适配器枚举，一张独显会被报成多条
    /// （本机 9070 XT 出现三次），不去重用户会以为装了三张卡。保留首条，
    /// 因为重复项的显存字段是一样的。
    /// </summary>
    private static List<FoundryLocalDeviceDto> ReadDevices(JsonElement element, string property)
    {
        var result = new List<FoundryLocalDeviceDto>();
        if (!element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Array) return result;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            var name = GetString(item, "name");
            if (string.IsNullOrWhiteSpace(name) || !seen.Add(name)) continue;

            result.Add(new FoundryLocalDeviceDto
            {
                Name = name,
                Vendor = GetString(item, "vendor"),
                VideoMemoryBytes = GetLong(item, "videoMemoryBytes"),
            });
        }
        return result;
    }

    /// <summary>CLI 给的是 Cpu / Gpu / Npu，统一成 CPU / GPU / NPU</summary>
    private static string? NormalizeDevice(string? device)
        => device?.ToUpperInvariant() switch
        {
            "CPU" => "CPU",
            "GPU" => "GPU",
            "NPU" => "NPU",
            _ => null,
        };

    /// <summary>去掉 ExecutionProvider 后缀，CPUExecutionProvider → CPU</summary>
    private static string? NormalizeEp(string? ep)
    {
        if (string.IsNullOrWhiteSpace(ep)) return null;
        return ep.EndsWith("ExecutionProvider", StringComparison.Ordinal)
            ? ep[..^"ExecutionProvider".Length]
            : ep;
    }

    /// <summary>CLI 参数拼进命令行，带空格的路径必须整体加引号</summary>
    public static string Quote(string value)
        => value.Contains(' ') ? $"\"{value}\"" : value;
}
