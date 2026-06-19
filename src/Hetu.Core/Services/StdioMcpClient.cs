using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Hetu.Shared.AI;

namespace Hetu.Core.Services;

public class StdioMcpClient : IDisposable
{
    private readonly Process _process;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private int _requestId;
    private bool _disposed;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public StdioMcpClient(string connectionConfigJson)
    {
        var config = JsonSerializer.Deserialize<McpStdioConfig>(connectionConfigJson, JsonOptions)
                     ?? throw new ArgumentException("无效的 MCP stdio 配置");

        if (string.IsNullOrWhiteSpace(config.Command))
            throw new ArgumentException("MCP stdio 配置缺少 command");

        _process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = config.Command,
                Arguments = string.Join(" ", config.Args ?? []),
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = config.WorkingDirectory ?? Environment.CurrentDirectory
            }
        };

        if (config.Env != null)
        {
            foreach (var kv in config.Env)
            {
                _process.StartInfo.EnvironmentVariables[kv.Key] = kv.Value;
            }
        }

        if (!_process.Start())
            throw new InvalidOperationException("无法启动 MCP Server 进程");

        _process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data))
            {
                Console.Error.WriteLine($"[MCP stderr] {e.Data}");
            }
        };
        _process.BeginErrorReadLine();
    }

    public async Task<List<McpToolDto>> ListToolsAsync(CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);
        var response = await SendRequestAsync("tools/list", new { }, cancellationToken);
        return ParseTools(response);
    }

    public async Task<CallMcpToolResultDto> CallToolAsync(string toolName, Dictionary<string, object>? arguments, CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);
        var response = await SendRequestAsync("tools/call", new { name = toolName, arguments = arguments ?? new Dictionary<string, object>() }, cancellationToken);
        return ParseToolResult(response);
    }

    private async Task InitializeAsync(CancellationToken cancellationToken)
    {
        var initResponse = await SendRequestAsync("initialize", new
        {
            protocolVersion = "2024-11-05",
            capabilities = new { },
            clientInfo = new { name = "Hetu", version = "1.0.0" }
        }, cancellationToken);

        // Send initialized notification
        var notification = new
        {
            jsonrpc = "2.0",
            method = "notifications/initialized"
        };
        await WriteLineAsync(JsonSerializer.Serialize(notification), cancellationToken);
    }

    private async Task<JsonElement> SendRequestAsync(string method, object parameters, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var id = Interlocked.Increment(ref _requestId);
            var request = new
            {
                jsonrpc = "2.0",
                id,
                method,
                @params = parameters
            };

            var requestJson = JsonSerializer.Serialize(request);
            await WriteLineAsync(requestJson, cancellationToken);

            var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

            while (!linkedCts.Token.IsCancellationRequested)
            {
                var line = await ReadLineAsync(linkedCts.Token);
                if (line == null)
                    throw new InvalidOperationException("MCP Server 进程已结束输出");

                if (string.IsNullOrWhiteSpace(line)) continue;

                JsonDocument? doc = null;
                try
                {
                    doc = JsonDocument.Parse(line);
                }
                catch
                {
                    continue;
                }

                using var document = doc;
                var root = document.RootElement;

                // Skip notifications
                if (!root.TryGetProperty("id", out _)) continue;

                if (root.TryGetProperty("error", out var error) && error.ValueKind != JsonValueKind.Null)
                {
                    var message = error.TryGetProperty("message", out var msg) ? msg.GetString() : "未知错误";
                    throw new InvalidOperationException($"MCP 错误：{message}");
                }

                if (root.TryGetProperty("result", out var result))
                {
                    return result.Clone();
                }
            }

            throw new OperationCanceledException("等待 MCP 响应超时");
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task WriteLineAsync(string json, CancellationToken cancellationToken)
    {
        if (_process.HasExited)
            throw new InvalidOperationException("MCP Server 进程已退出");

        await _process.StandardInput.WriteLineAsync(json.AsMemory(), cancellationToken);
        await _process.StandardInput.FlushAsync(cancellationToken);
    }

    private async Task<string?> ReadLineAsync(CancellationToken cancellationToken)
    {
        var tcs = new TaskCompletionSource<string?>();
        await using (cancellationToken.Register(() => tcs.TrySetCanceled()))
        {
            var readTask = _process.StandardOutput.ReadLineAsync();
            var completed = await Task.WhenAny(readTask, tcs.Task);
            if (completed == tcs.Task)
                await tcs.Task;
            return await readTask;
        }
    }

    private static List<McpToolDto> ParseTools(JsonElement result)
    {
        var tools = new List<McpToolDto>();
        if (!result.TryGetProperty("tools", out var toolsElement)) return tools;

        foreach (var tool in toolsElement.EnumerateArray())
        {
            tools.Add(new McpToolDto
            {
                Name = tool.TryGetProperty("name", out var name) ? name.GetString() ?? string.Empty : string.Empty,
                Description = tool.TryGetProperty("description", out var desc) ? desc.GetString() : null,
                InputSchema = tool.TryGetProperty("inputSchema", out var schema) ? schema.Clone() : null
            });
        }

        return tools;
    }

    private static CallMcpToolResultDto ParseToolResult(JsonElement result)
    {
        var sb = new StringBuilder();
        var isError = false;

        if (result.TryGetProperty("isError", out var err) && err.ValueKind == JsonValueKind.True)
            isError = true;

        if (result.TryGetProperty("content", out var content))
        {
            foreach (var item in content.EnumerateArray())
            {
                if (item.TryGetProperty("text", out var text))
                {
                    sb.Append(text.GetString());
                }
            }
        }

        return new CallMcpToolResultDto
        {
            Content = sb.ToString(),
            IsError = isError
        };
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch { }

        _process.Dispose();
        _lock.Dispose();
    }

    private class McpStdioConfig
    {
        public string Command { get; set; } = string.Empty;
        public List<string> Args { get; set; } = [];
        public Dictionary<string, string> Env { get; set; } = [];
        public string? WorkingDirectory { get; set; }
    }
}
