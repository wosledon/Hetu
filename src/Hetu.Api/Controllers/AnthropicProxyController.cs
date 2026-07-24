using System.Text.Json;
using Hetu.Core.Services;
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

    [HttpPost("messages")]
    public async Task Messages(CancellationToken ct)
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
        using var upstream = await _forwarder.ForwardStreamAsync(target, "/messages", payload, ct);
        await CopyUpstreamAsync(upstream, Response, ct);
    }

    private static async Task CopyUpstreamAsync(HttpResponseMessage upstream, HttpResponse output, CancellationToken ct)
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
        output.ContentType = "text/event-stream";
        output.Headers.CacheControl = "no-cache";
        output.Headers.Connection = "keep-alive";
        await using var stream = await upstream.Content.ReadAsStreamAsync(ct);
        await stream.CopyToAsync(output.Body, ct);
    }

    private async Task WriteError(string message)
    {
        Response.StatusCode = 400;
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
        dict["model"] = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(modelId)).RootElement;
        return JsonSerializer.Serialize(dict);
    }
}
