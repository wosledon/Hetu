using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Client;

namespace Hetu.Agents;

/// <summary>
/// 基于官方 ModelContextProtocol SDK 的 MCP 客户端缓存。
/// stdio 与 HTTP/SSE 服务器共用同一入口；同一份连接配置只建立一条连接。
/// </summary>
public sealed class McpClientProvider
{
    private readonly ConcurrentDictionary<string, Lazy<Task<McpClient>>> _clients = new(StringComparer.Ordinal);
    private readonly ILoggerFactory _loggerFactory;

    public McpClientProvider(ILoggerFactory loggerFactory) => _loggerFactory = loggerFactory;

    public Task<McpClient> GetAsync(string connectionConfigJson, CancellationToken cancellationToken = default)
    {
        var lazy = _clients.GetOrAdd(connectionConfigJson, key => new Lazy<Task<McpClient>>(
            () => CreateAsync(key), LazyThreadSafetyMode.ExecutionAndPublication));
        return lazy.Value.WaitAsync(cancellationToken);
    }

    public void Invalidate(string connectionConfigJson)
    {
        if (!_clients.TryRemove(connectionConfigJson, out var lazy) || !lazy.IsValueCreated)
            return;
        _ = DisposeWhenReadyAsync(lazy.Value);
    }

    private static async Task DisposeWhenReadyAsync(Task<McpClient> task)
    {
        try
        {
            await using var client = await task;
        }
        catch
        {
            // 建连失败无需清理
        }
    }

    private async Task<McpClient> CreateAsync(string connectionConfigJson)
    {
        var transport = CreateTransport(connectionConfigJson);
        return await McpClient.CreateAsync(
            transport,
            loggerFactory: _loggerFactory,
            cancellationToken: CancellationToken.None);
    }

    private static IClientTransport CreateTransport(string connectionConfigJson)
    {
        var trimmed = connectionConfigJson.Trim();
        if (trimmed.StartsWith('{'))
        {
            using var doc = JsonDocument.Parse(trimmed);
            var root = doc.RootElement;
            if (root.TryGetProperty("url", out var urlElement) && urlElement.ValueKind == JsonValueKind.String)
                return CreateHttpTransport(urlElement.GetString()!, "mcp-http");

            var command = root.TryGetProperty("command", out var commandElement) ? commandElement.GetString() : null;
            if (string.IsNullOrWhiteSpace(command))
                throw new ArgumentException("MCP stdio 配置缺少 command");

            var args = root.TryGetProperty("args", out var argsElement) && argsElement.ValueKind == JsonValueKind.Array
                ? argsElement.EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToList()
                : [];
            var env = new Dictionary<string, string?>(StringComparer.Ordinal);
            if (root.TryGetProperty("env", out var envElement) && envElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in envElement.EnumerateObject())
                    env[property.Name] = property.Value.GetString() ?? string.Empty;
            }
            var workingDirectory = root.TryGetProperty("workingDirectory", out var wdElement)
                ? wdElement.GetString()
                : null;

            return new StdioClientTransport(new StdioClientTransportOptions
            {
                Name = "mcp-stdio",
                Command = command,
                Arguments = args,
                EnvironmentVariables = env,
                WorkingDirectory = workingDirectory,
                InheritEnvironmentVariables = true,
                StandardErrorLines = line =>
                {
                    if (!string.IsNullOrWhiteSpace(line)) Console.Error.WriteLine($"[MCP stderr] {line}");
                },
            });
        }

        if (Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            && uri.Scheme is "http" or "https")
            return CreateHttpTransport(trimmed, "mcp-http");

        throw new ArgumentException("无法识别的 MCP 连接配置");
    }

    private static HttpClientTransport CreateHttpTransport(string endpoint, string name)
        => new(new HttpClientTransportOptions
        {
            Name = name,
            Endpoint = new Uri(endpoint, UriKind.Absolute),
            TransportMode = HttpTransportMode.AutoDetect,
        });
}