using System.Text.Json;
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

    public AnthropicProxyController(ProxyService proxyService, ProxyForwarder forwarder)
    {
        _proxyService = proxyService;
        _forwarder = forwarder;
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
        var streaming = root.TryGetProperty("stream", out var s) && s.ValueKind == JsonValueKind.True;
        using var upstream = await _forwarder.ForwardStreamAsync(target, "/messages", payload, ct);
        await CopyUpstreamAsync(upstream, Response, streaming, ct);
    }

    private static async Task CopyUpstreamAsync(HttpResponseMessage upstream, HttpResponse output, bool streaming, CancellationToken ct)
    {
        if (!upstream.IsSuccessStatusCode)
        {
            output.StatusCode = (int)upstream.StatusCode;
            output.ContentType = "application/json";
            var err = await upstream.Content.ReadAsStringAsync(ct);
            await output.WriteAsync(err, ct);
            return;
        }

        output.StatusCode = 200;
        if (streaming)
        {
            output.StartSseStream();
        }
        else
        {
            // 非流式请求原样透传上游 Content-Type，否则客户端按 SSE 解析 JSON 响应体会失败
            output.ContentType = upstream.Content.Headers.ContentType?.ToString() ?? "application/json";
        }

        await using var stream = await upstream.Content.ReadAsStreamAsync(ct);
        await stream.CopyToAsync(output.Body, ct);
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

    private static string RewriteModel(JsonElement root, string modelId)
    {
        var dict = new Dictionary<string, JsonElement>();
        foreach (var p in root.EnumerateObject()) dict[p.Name] = p.Value.Clone();
        dict["model"] = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(modelId)).RootElement.Clone();
        return JsonSerializer.Serialize(dict);
    }
}
