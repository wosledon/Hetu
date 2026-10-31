using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.FoundryLocal;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using FoundrySdk = Microsoft.AI.Foundry.Local;

namespace Hetu.Infrastructure.FoundryLocal;

/// <summary>
/// Foundry Local 管理面实现，包装 SDK 的 <see cref="FoundrySdk.FoundryLocalManager"/> 单例。
///
/// 两条硬约束：
/// 1) 平台守卫：SDK 依赖原生库，非 Windows（或原生库缺失）时一律不触碰，直接返回不支持。
///    检测放在第一次调用而不是构造函数里——构造时探测会让整个 DI 图在 Linux 上启动即炸。
/// 2) SDK 单例且非线程安全：所有调用串到 <see cref="_gate"/> 里，避免并发下载/加载互相踩。
/// </summary>
public class FoundryLocalService : IFoundryLocalService
{
    /// <summary>保存模型目录的 AppSettings 键</summary>
    public const string ModelDirSettingKey = "FoundryLocalModelDir";

    private readonly FoundryLocalOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILocalizer _localizer;
    private readonly ILogger<FoundryLocalService> _logger;
    private readonly ILoggerFactory _loggerFactory;

    /// <summary>SDK 调用互斥门</summary>
    private readonly SemaphoreSlim _gate = new(1, 1);

    private FoundrySdk.FoundryLocalManager? _manager;
    private bool _platformChecked;
    private string? _unsupportedReason;
    private string? _modelDir;
    private bool _webServiceStarted;
    private bool _restartRequired;
    private string? _pendingModelDir;

    public FoundryLocalService(
        IOptions<FoundryLocalOptions> options,
        IServiceScopeFactory scopeFactory,
        ILocalizer localizer,
        ILoggerFactory loggerFactory,
        ILogger<FoundryLocalService> logger)
    {
        _options = options.Value;
        _scopeFactory = scopeFactory;
        _localizer = localizer;
        _loggerFactory = loggerFactory;
        _logger = logger;
    }

    public string? GetUnsupportedReason()
    {
        EnsurePlatformChecked();
        return _unsupportedReason;
    }

    public async Task<FoundryLocalStatusDto> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var status = new FoundryLocalStatusDto
        {
            Supported = IsSupported(),
            UnsupportedReason = GetUnsupportedReason(),
            ModelDir = await ResolveModelDirAsync(cancellationToken),
            DefaultModelDir = _options.DefaultModelDir,
            PendingModelDir = _pendingModelDir,
            RestartRequired = _restartRequired,
        };
        if (!status.Supported) return status;

        try
        {
            var manager = await GetManagerAsync(cancellationToken);
            if (manager == null) return status;

            status.Endpoint = FirstEndpoint(manager);
            // 「运行中」指本地 OpenAI 兼容服务在听，不是 SDK 运行时本身：
            // 运行时初始化成功但服务没启动时端点为空，那时应显示未启动
            status.Running = !string.IsNullOrEmpty(status.Endpoint) || _webServiceStarted;
            if (status.Running)
            {
                var catalog = await manager.GetCatalogAsync(FoundrySdk.CatalogType.Local, cancellationToken);
                if (catalog != null)
                {
                    var cached = await catalog.GetCachedModelsAsync(cancellationToken);
                    var loaded = await catalog.GetLoadedModelsAsync(cancellationToken);
                    status.CachedCount = cached.Count;
                    status.LoadedCount = loaded.Count;
                }
            }
        }
        catch (Exception ex)
        {
            // 运行时起不来不算致命：页面照常展示，用户能看到原因再重试
            _logger.LogWarning(ex, "读取 Foundry Local 状态失败");
            status.Running = false;
        }
        return status;
    }

    public async Task<List<FoundryLocalModelDto>> GetModelsAsync(bool includeCachedOnly = false, CancellationToken cancellationToken = default)
    {
        var empty = new List<FoundryLocalModelDto>();
        if (!IsSupported()) return empty;

        var manager = await GetManagerAsync(cancellationToken);
        if (manager == null) return empty;

        // Public 才是「可浏览可下载」的完整目录；Local 只有本机已有的
        var catalog = await manager.GetCatalogAsync(FoundrySdk.CatalogType.Public, cancellationToken);
        if (catalog == null) return empty;

        var registered = await GetRegisteredAliasesAsync(cancellationToken);
        var models = includeCachedOnly
            ? await catalog.GetCachedModelsAsync(cancellationToken)
            : await catalog.ListModelsAsync(cancellationToken);

        var result = new List<FoundryLocalModelDto>(models.Count);
        foreach (var model in models)
        {
            cancellationToken.ThrowIfCancellationRequested();
            result.Add(await MapAsync(model, registered, cancellationToken));
        }
        // 已下载的排前面，再按名字，方便直接找到能用的
        return result
            .OrderByDescending(m => m.IsCached)
            .ThenBy(m => m.DisplayName ?? m.Alias, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task DownloadAsync(string alias, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        var model = await GetModelAsync(alias, cancellationToken);
        if (model == null) return;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            // SDK 的进度回调给的是 0~1 的 float，直接透出；百分比由前端算
            await model.DownloadAsync(p => progress?.Report(p), cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RemoveFromCacheAsync(string alias, CancellationToken cancellationToken = default)
    {
        var model = await GetModelAsync(alias, cancellationToken);
        if (model == null) return;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (await model.IsLoadedAsync(cancellationToken))
                await model.UnloadAsync(cancellationToken);
            await model.RemoveFromCacheAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task LoadAsync(string alias, CancellationToken cancellationToken = default)
    {
        var model = await GetModelAsync(alias, cancellationToken);
        if (model == null) throw new InvalidOperationException(_localizer.T("foundry.modelNotFound", alias));

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!await model.IsCachedAsync(cancellationToken))
                throw new InvalidOperationException(_localizer.T("foundry.notDownloaded"));
            await model.LoadAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task UnloadAsync(string alias, CancellationToken cancellationToken = default)
    {
        var model = await GetModelAsync(alias, cancellationToken);
        if (model == null) return;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await model.UnloadAsync(cancellationToken);
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

        var manager = await GetManagerAsync(cancellationToken);
        if (manager == null) return empty;

        var catalog = await manager.GetCatalogAsync(FoundrySdk.CatalogType.Public, cancellationToken);
        if (catalog == null) return empty;

        var registered = await GetRegisteredAliasesAsync(cancellationToken);
        var loaded = await catalog.GetLoadedModelsAsync(cancellationToken);
        var result = new List<FoundryLocalModelDto>(loaded.Count);
        foreach (var model in loaded)
            result.Add(await MapAsync(model, registered, cancellationToken));
        return result;
    }

    public async Task StartServiceAsync(CancellationToken cancellationToken = default)
    {
        var manager = await GetManagerAsync(cancellationToken);
        if (manager == null) return;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_webServiceStarted) return;
            await manager.StartWebServiceAsync(cancellationToken);
            _webServiceStarted = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopServiceAsync(CancellationToken cancellationToken = default)
    {
        var manager = await GetManagerAsync(cancellationToken);
        if (manager == null) return;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await manager.StopWebServiceAsync(cancellationToken);
            _webServiceStarted = false;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// 设置模型保存路径；传空或空白恢复默认。
    /// 注意：SDK 的运行时是进程级单例，初始化后无法重建，所以这里只落库，
    /// 新路径要等下次启动才生效（<see cref="FoundryLocalStatusDto.RestartRequired"/> 为 true）。
    /// </summary>
    public async Task<string> SetModelDirAsync(string? path, CancellationToken cancellationToken = default)
    {
        var target = string.IsNullOrWhiteSpace(path)
            ? _options.DefaultModelDir
            : Path.GetFullPath(path.Trim());

        if (!Path.IsPathFullyQualified(target))
            throw new ArgumentException(_localizer.T("foundry.modelDirNotAbsolute"), nameof(path));

        await WithScopedServicesAsync(async (settings, _, _) =>
        {
            await settings.SetAsync(new Hetu.Shared.Settings.UpdateAppSettingRequest
            {
                Key = ModelDirSettingKey,
                Value = target,
            }, cancellationToken);
            return true;
        }, cancellationToken);

        // 只在真正换了路径时提示重启；恢复默认而本来就是默认则不用
        if (!string.Equals(_modelDir, target, StringComparison.OrdinalIgnoreCase))
        {
            _restartRequired = true;
            _pendingModelDir = target;
        }
        else
        {
            _restartRequired = false;
            _pendingModelDir = null;
        }

        return target;
    }

    public async Task<string> ResetModelDirAsync(CancellationToken cancellationToken = default)
        => await SetModelDirAsync(null, cancellationToken);

    public async Task<Guid> RegisterAsProviderModelAsync(string alias, string purpose, CancellationToken cancellationToken = default)
    {
        var model = await GetModelAsync(alias, cancellationToken)
            ?? throw new InvalidOperationException(_localizer.T("foundry.modelNotFound", alias));

        var providerId = await WithScopedServicesAsync(async (_, providers, _) =>
        {
            var existing = (await providers.GetAllAsync(cancellationToken)).Data?.FirstOrDefault(p =>
                string.Equals(p.ProviderType, "foundry", StringComparison.OrdinalIgnoreCase));
            if (existing != null) return existing.Id;

            var created = (await providers.CreateAsync(new Hetu.Shared.AI.CreateAiProviderRequest
            {
                ProviderType = "foundry",
                Name = "Foundry Local",
                IsEnabled = true,
            }, cancellationToken)).Data;
            return created?.Id ?? throw new InvalidOperationException(_localizer.T("foundry.registerFailed", "provider"));
        }, cancellationToken);

        var modelId = await WithScopedServicesAsync(async (_, _, models) =>
        {
            var info = model.Info;
            var created = await models.CreateAsync(new Hetu.Shared.AI.CreateAiModelRequest
            {
                ProviderId = providerId,
                ModelId = model.Alias,
                DisplayName = info.DisplayName ?? info.Name ?? model.Alias,
                Purpose = purpose,
                ContextWindow = info.ContextLength is > 0 and < int.MaxValue ? (int?)info.ContextLength : null,
                SupportsTools = info.SupportsToolCalling ?? false,
            }, cancellationToken);
            return created.Data?.Id ?? throw new InvalidOperationException(_localizer.T("foundry.registerFailed", alias));
        }, cancellationToken);

        return modelId;
    }

    /// <summary>平台探测，只做一次。放在首次调用而不是构造函数里：构造时探测会让整个 DI 图在 Linux 上启动即炸</summary>
    private void EnsurePlatformChecked()
    {
        if (_platformChecked) return;
        _platformChecked = true;

        if (!OperatingSystem.IsWindows())
        {
            _unsupportedReason = _localizer.T("foundry.windowsOnly");
            return;
        }

        // 原生库由 NuGet 包按 RID 拷贝到输出目录；缺了就是安装包不完整
        if (!File.Exists(Path.Combine(AppContext.BaseDirectory, "foundry_local.dll")))
            _unsupportedReason = _localizer.T("foundry.nativeMissing");
    }

    private bool IsSupported()
    {
        EnsurePlatformChecked();
        return _unsupportedReason == null;
    }

    /// <summary>生效的模型保存路径：设置里配过用配置，否则用默认。只读一次，改路径时会同步刷新</summary>
    private async Task<string> ResolveModelDirAsync(CancellationToken cancellationToken)
    {
        if (_modelDir != null) return _modelDir;

        await using var scope = _scopeFactory.CreateAsyncScope();
        var settings = scope.ServiceProvider.GetRequiredService<IAppSettingService>();
        var configured = (await settings.GetAsync(ModelDirSettingKey, cancellationToken)).Data?.Value;
        _modelDir = string.IsNullOrWhiteSpace(configured) ? _options.DefaultModelDir : configured;
        return _modelDir;
    }

    /// <summary>
    /// 本服务是单例（内部要共享 SDK 门禁），而设置/服务商服务都是 scoped，
    /// 所以按需开一个子作用域来拿它们，不能直接注入。
    /// </summary>
    private async Task<T> WithScopedServicesAsync<T>(
        Func<IAppSettingService, IAiProviderService, IAiModelService, Task<T>> work,
        CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        return await work(
            scope.ServiceProvider.GetRequiredService<IAppSettingService>(),
            scope.ServiceProvider.GetRequiredService<IAiProviderService>(),
            scope.ServiceProvider.GetRequiredService<IAiModelService>());
    }

    /// <summary>懒初始化 SDK 单例。任何失败都只记日志并返回 null，不向调用方抛</summary>
    private async Task<FoundrySdk.FoundryLocalManager?> GetManagerAsync(CancellationToken cancellationToken)
    {
        if (!IsSupported()) return null;
        if (_manager != null) return _manager;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_manager != null) return _manager;

            var modelDir = await ResolveModelDirAsync(cancellationToken);
            Directory.CreateDirectory(modelDir);
            var configuration = new FoundrySdk.Configuration
            {
                AppName = "Hetu",
                ModelCacheDir = modelDir,
                LogsDir = Path.Combine(Path.GetTempPath(), "hetu-foundry-logs"),
                LogLevel = FoundrySdk.LogLevel.Warning,
            };

            // CreateAsync 是 async Task（不返回管理器），初始化完成后从 Instance 取
            await FoundrySdk.FoundryLocalManager.CreateAsync(
                configuration, _loggerFactory.CreateLogger("FoundryLocal"), cancellationToken);
            var manager = FoundrySdk.FoundryLocalManager.Instance;
            _manager = manager;
            _logger.LogInformation("Foundry Local 运行时已就绪，模型目录 {Dir}", modelDir);
            return manager;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "初始化 Foundry Local 运行时失败");
            return null;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<FoundrySdk.IModel?> GetModelAsync(string alias, CancellationToken cancellationToken)
    {
        var manager = await GetManagerAsync(cancellationToken);
        if (manager == null) return null;

        // Public 目录：按 alias 找模型，下载/加载/删除都以它为准
        var catalog = await manager.GetCatalogAsync(FoundrySdk.CatalogType.Public, cancellationToken);
        if (catalog == null) return null;

        return await catalog.GetModelAsync(alias, cancellationToken);
    }

    private static string? FirstEndpoint(FoundrySdk.FoundryLocalManager manager)
    {
        var url = manager.Urls?.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(url)) return null;
        // SDK 给的是 http://127.0.0.1:5272 这类根地址，OpenAI 客户端要带 /v1
        var trimmed = url.TrimEnd('/');
        return trimmed.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? trimmed : $"{trimmed}/v1";
    }

    private async Task<HashSet<string>> GetRegisteredAliasesAsync(CancellationToken cancellationToken)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await WithScopedServicesAsync(async (_, providers, _) =>
        {
            var all = await providers.GetAllAsync(cancellationToken);
            foreach (var provider in all.Data ?? [])
            {
                if (!string.Equals(provider.ProviderType, "foundry", StringComparison.OrdinalIgnoreCase)) continue;
                foreach (var model in provider.Models)
                    result.Add(model.ModelId);
            }
            return true;
        }, cancellationToken);
        return result;
    }

    private static async Task<FoundryLocalModelDto> MapAsync(
        FoundrySdk.IModel model,
        HashSet<string> registered,
        CancellationToken cancellationToken)
    {
        var info = model.Info;
        var cached = await model.IsCachedAsync(cancellationToken);
        var loaded = await model.IsLoadedAsync(cancellationToken);
        // ModelInfo 的上下文字段在部分目录条目上是空的，退回按 key 直取
        var contextLength = info.ContextLength ?? ParseLong(model.GetStringProperty(FoundrySdk.ModelInfoPropertyKeys.ContextLength));
        var maxOutputTokens = info.MaxOutputTokens ?? ParseLong(model.GetStringProperty(FoundrySdk.ModelInfoPropertyKeys.MaxOutputTokens));
        return new FoundryLocalModelDto
        {
            Alias = model.Alias,
            Id = model.Id,
            DisplayName = info.DisplayName ?? info.Name ?? model.Alias,
            Publisher = info.Publisher,
            ModelType = info.ModelType,
            Task = info.Task,
            License = info.License,
            Uri = info.Uri,
            FileSizeMb = info.FileSizeMb,
            ContextLength = contextLength,
            MaxOutputTokens = maxOutputTokens,
            SupportsToolCalling = info.SupportsToolCalling ?? ParseBool(model.GetStringProperty(FoundrySdk.ModelInfoPropertyKeys.SupportsToolCalling)),
            IsCached = cached,
            IsLoaded = loaded,
            Variants = model.Variants.Select(v => v.Alias).Where(a => !string.IsNullOrWhiteSpace(a)).ToList(),
            IsRegistered = registered.Contains(model.Alias),
        };
    }

    private static long? ParseLong(string? value)
        => long.TryParse(value, out var parsed) ? parsed : null;

    private static bool ParseBool(string? value)
        => bool.TryParse(value, out var parsed) && parsed;
}
