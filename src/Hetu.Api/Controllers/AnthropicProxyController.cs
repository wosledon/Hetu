using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Utilities;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// Anthropic 兼容代理端点。客户端把 model 设为代理端点的虚拟 ModelKey 即可。
/// 仅转发到 Anthropic 协议的目标供应商，不做协议互转。
/// </summary>
[ApiController]
[Route("v1/anthropic")]
public class AnthropicProxyController : ControllerBase
{
    private readonly ProxyService _proxyService;
    private readonly ProxyForwarder _forwarder;
    private readonly ILlmUsageRecorder _usage;
    private readonly ILogger<AnthropicProxyController> _logger;

    public AnthropicProxyController(ProxyService proxyService, ProxyForwarder forwarder, ILlmUsageRecorder usage, ILogger<AnthropicProxyController> logger)
    {
        _proxyService = proxyService;
        _forwarder = forwarder;
        _usage = usage;
        _logger = logger;
    }

    /// <summary>Anthropic 兼容的模型列表，客户端接入前先拉这个端点挑模型。</summary>
    [HttpGet("models")]
    public async Task<IActionResult> Models(CancellationToken ct)
    {
        var configs = await _proxyService.GetAllAsync(ct);
        var data = configs
            .Where(c => !string.IsNullOrWhiteSpace(c.ModelKey))
            .Select(c => new
            {
                type = "model",
                id = c.ModelKey,
                display_name = c.Mode == "route" ? "Hetu Route" : "Hetu Shadow",
                created_at = "1970-01-01T00:00:00Z",
            });
        return Ok(new { data, has_more = false, first_id = (string?)null, last_id = (string?)null });
    }

    [HttpPost("messages")]
    public async Task Messages(CancellationToken ct)
    {
        try
        {
            await MessagesCoreAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // 客户端主动断开，无需再写错误响应
        }
        catch (Exception ex)
        {
            // 上游不可达 / 解析失败统一转成 Anthropic 错误结构，不向客户端泄漏堆栈
            if (!Response.HasStarted)
                await WriteError($"proxy forward failed: {ex.Message}", 502);
        }
    }

    private async Task MessagesCoreAsync(CancellationToken ct)
    {
        using var doc = await JsonDocument.ParseAsync(Request.Body, cancellationToken: ct);
        var root = doc.RootElement;
        var modelKey = root.TryGetProperty("model", out var m) ? m.GetString() : null;

        if (string.IsNullOrWhiteSpace(modelKey))
        {
            await WriteError("model is required");
            return;
        }

        var endpoint = await _proxyService.GetByModelKeyAsync(modelKey, ct);
        if (endpoint == null)
        {
            await WriteError($"unknown proxy model: {modelKey}");
            return;
        }

        var userText = ExtractLastUserText(root);
        var targetKey = await _proxyService.ResolveTargetModelKeyAsync(endpoint, userText, ct);
        var target = await _forwarder.ResolveTargetAsync(targetKey, "anthropic", ct);
        if (target == null)
        {
            await WriteError("no valid anthropic target model resolved");
            return;
        }

        var payload = RewriteModel(root, target.ModelId);
        var inputLen = ExtractMessagesLength(root);
        var streaming = root.TryGetProperty("stream", out var s) && s.ValueKind == JsonValueKind.True;
        using var upstream = await _forwarder.ForwardStreamAsync(target, "/messages", payload, ct);
        var usage = await CopyUpstreamAsync(upstream, Response, streaming, ct);

        // 上游用量只能在响应体里拿到，所以拷贝时顺带解析；拿不到再回落到字符数估算
        var estimated = inputLen > 0 ? (int)Math.Ceiling(inputLen / 3.0) : (int?)null;
        await _usage.RecordAsync(
            source: LlmUsageSources.Proxy,
            usage: usage,
            refId: null,
            modelId: target.ModelEntityId,
            inputTokens: usage is { PromptTokens: > 0 } ? null : estimated,
            compressedTokens: null,
            contentPreview: $"[proxy:{modelKey}]",
            ct: ct);
    }

    /// <summary>透传上游响应，返回解析出的用量（上游未上报时为 null）。</summary>
    private async Task<LlmUsage?> CopyUpstreamAsync(HttpResponseMessage upstream, HttpResponse output, bool streaming, CancellationToken ct)
    {
        if (!upstream.IsSuccessStatusCode)
        {
            output.StatusCode = (int)upstream.StatusCode;
            output.ContentType = "application/json";
            var err = await upstream.Content.ReadAsStringAsync(ct);
            // 上游拒绝时必须把原因写进日志：代理是透传，客户端只看到状态码，
            // 不记日志就没法判断是参数不支持、鉴权失败还是模型名不对
            _logger.LogWarning("[Proxy] 上游返回 {Status}: {Body}", (int)upstream.StatusCode, err);
            await output.WriteAsync(err, ct);
            return null;
        }

        output.StatusCode = 200;
        if (streaming)
        {
            output.StartSseStream();
            // Anthropic 的 usage 分散在 message_start / message_delta 两个事件里，逐帧累积
            var accumulator = new ProxyUsageExtractor.AnthropicAccumulator();
            await ProxyUsageExtractor.CopyWithSseScanAsync(
                await upstream.Content.ReadAsStreamAsync(ct), output.Body, accumulator.Feed, ct);
            return accumulator.ToUsage();
        }

        // 非流式请求原样透传上游 Content-Type，否则客户端按 SSE 解析 JSON 响应体会失败
        output.ContentType = upstream.Content.Headers.ContentType?.ToString() ?? "application/json";
        // 整体读出来才能拿到 usage 对象；非流式响应本就一次成型，缓冲无副作用
        var body = await upstream.Content.ReadAsStringAsync(ct);
        await output.WriteAsync(body, ct);
        var nonStreamAccumulator = new ProxyUsageExtractor.AnthropicAccumulator();
        nonStreamAccumulator.Feed(body);
        return nonStreamAccumulator.ToUsage();
    }

    private async Task WriteError(string message, int statusCode = 400)
    {
        Response.StatusCode = statusCode;
        Response.ContentType = "application/json";
        await Response.WriteAsync(JsonSerializer.Serialize(new { type = "error", error = new { type = "proxy_error", message } }));
    }

    private static string ExtractLastUserText(JsonElement root)
    {
        try
        {
            if (root.TryGetProperty("messages", out var msgs) && msgs.ValueKind == JsonValueKind.Array)
            {
                string last = "";
                foreach (var msg in msgs.EnumerateArray())
                {
                    if (msg.TryGetProperty("role", out var r) && r.GetString() == "user" &&
                        msg.TryGetProperty("content", out var c))
                    {
                        if (c.ValueKind == JsonValueKind.String) last = c.GetString() ?? "";
                        else if (c.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var block in c.EnumerateArray())
                                if (block.TryGetProperty("type", out var t) && t.GetString() == "text" &&
                                    block.TryGetProperty("text", out var tx))
                                    last = tx.GetString() ?? "";
                        }
                    }
                }
                return last;
            }
        }
        catch { }
        return "";
    }

    private static int ExtractMessagesLength(JsonElement root)
    {
        if (!root.TryGetProperty("messages", out var msgs) || msgs.ValueKind != JsonValueKind.Array)
            return 0;
        var total = 0;
        foreach (var msg in msgs.EnumerateArray())
        {
            if (!msg.TryGetProperty("content", out var c)) continue;
            // content 可能是字符串，也可能是 text block 数组
            if (c.ValueKind == JsonValueKind.String) total += c.GetString()?.Length ?? 0;
            else if (c.ValueKind == JsonValueKind.Array)
            {
                foreach (var block in c.EnumerateArray())
                    if (block.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String)
                        total += t.GetString()?.Length ?? 0;
            }
        }
        return total;
    }

    private static string RewriteModel(JsonElement root, string modelId)
    {
        var dict = new Dictionary<string, JsonElement>();
        foreach (var p in root.EnumerateObject()) dict[p.Name] = p.Value.Clone();
        dict["model"] = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(modelId)).RootElement.Clone();
        return JsonSerializer.Serialize(dict);
    }
}
