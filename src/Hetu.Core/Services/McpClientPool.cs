using System.Collections.Concurrent;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

/// <summary>
/// MCP 客户端池：同一份连接配置复用同一个 stdio 子进程。
/// 过去每次列出工具、每次调用工具都会重新拉起进程 + 重新 initialize，
/// 单轮里多个 MCP 调用会反复付出 0.5–2s 的启动成本。
/// 进程随应用生命周期常驻；配置变化会因 key 不同自然切到新进程。
/// </summary>
public sealed class McpClientPool
{
    public static McpClientPool Shared { get; } = new();

    private readonly ConcurrentDictionary<string, Lazy<Task<StdioMcpClient>>> _clients = new(StringComparer.Ordinal);

    public async Task<StdioMcpClient> GetAsync(string connectionConfigJson, ILocalizer localizer, CancellationToken ct)
    {
        var lazy = _clients.GetOrAdd(connectionConfigJson, key => new Lazy<Task<StdioMcpClient>>(
            () => Task.Run(() => new StdioMcpClient(key, localizer), CancellationToken.None),
            LazyThreadSafetyMode.ExecutionAndPublication));

        try
        {
            return await lazy.Value.WaitAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 启动失败不缓存，下一次调用重新尝试
            _clients.TryRemove(new KeyValuePair<string, Lazy<Task<StdioMcpClient>>>(connectionConfigJson, lazy));
            throw;
        }
    }

    /// <summary>调用失败时摘除池里的客户端：进程可能已退出，下次调用重新拉起</summary>
    public void Invalidate(string connectionConfigJson)
    {
        if (!_clients.TryRemove(connectionConfigJson, out var lazy)) return;
        if (lazy.IsValueCreated && lazy.Value.IsCompletedSuccessfully) lazy.Value.Result.Dispose();
    }
}
