using System.Text.Json;
using Hetu.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// OpenAI 兼容代理端点。客户端把 model 设为代理端点的虚拟 ModelKey 即可。
/// 仅转发到 OpenAI 协议的目标供应商，不做协议互转。
/// </summary>
[ApiController]
[Route("v1")]
public class OpenAiProxyController : ControllerBase
{
    private readonly ProxyService _proxyService;
    private readonly ProxyForwarder _forwarder;
    private readonly CompressionPipelineService _compression;

    public OpenAiProxyController(ProxyService proxyService, ProxyForwarder forwarder, CompressionPipelineService compression)
    {
        _proxyService = proxyService;
        _forwarder = forwarder;
        _compression = compression;
    }

    [HttpPost("chat/completions")]
    public async Task ChatCompletions(CancellationToken ct)
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
        var target = await _forwarder.ResolveTargetAsync(targetKey, "openai", ct);
        if (target == null)
        {
            await WriteError("no valid openai target model resolved");
            return;
        }

        // 重写 model 为真实模型，压缩消息后转发
        var payloadJson = RewriteModel(root, target.ModelId);
        payloadJson = await CompressMessagesInPayload(payloadJson, ct);
        using var upstream = await _forwarder.ForwardStreamAsync(target, "/chat/completions", payloadJson, ct);
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
        await Response.WriteAsync(JsonSerializer.Serialize(new { error = new { message, type = "proxy_error" } }));
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
                        last = c.ValueKind == JsonValueKind.String ? c.GetString() ?? "" : c.ToString();
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
        using var doc = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(new { model = modelId }));
        var dict = new Dictionary<string, JsonElement>();
        foreach (var p in root.EnumerateObject()) dict[p.Name] = p.Value.Clone();
        dict["model"] = doc.RootElement.GetProperty("model").Clone();
        return JsonSerializer.Serialize(dict);
    }

    private async Task<string> CompressMessagesInPayload(string json, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (!root.TryGetProperty("messages", out var msgsEl) || msgsEl.ValueKind != JsonValueKind.Array)
            return json;

        var messages = new List<Dictionary<string, object>>();
        foreach (var m in msgsEl.EnumerateArray())
        {
            var msg = new Dictionary<string, object>();
            foreach (var p in m.EnumerateObject())
                msg[p.Name] = p.Value.ValueKind switch
                {
                    JsonValueKind.String => p.Value.GetString() ?? "",
                    JsonValueKind.Number => p.Value.GetDouble(),
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    _ => p.Value.ToString()
                };

            if (msg.TryGetValue("content", out var c) && c is string s && s.Length > 100)
                msg["content"] = await _compression.CompressAsync(s, ct);

            messages.Add(msg);
        }

        var payload = new Dictionary<string, object>();
        foreach (var p in root.EnumerateObject())
            payload[p.Name] = p.Name == "messages" ? messages : p.Value.ValueKind switch
            {
                JsonValueKind.String => p.Value.GetString() ?? "",
                JsonValueKind.Number => p.Value.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => p.Value.ToString()
            };

        return JsonSerializer.Serialize(payload);
    }
}
