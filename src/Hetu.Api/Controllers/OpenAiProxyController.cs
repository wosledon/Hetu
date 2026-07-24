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

    public OpenAiProxyController(ProxyService proxyService, ProxyForwarder forwarder)
    {
        _proxyService = proxyService;
        _forwarder = forwarder;
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

        // 重写 model 为真实模型，其余字段原样透传
        var payload = RewriteModel(root, target.ModelId);
        using var upstream = await _forwarder.ForwardStreamAsync(target, "/chat/completions", payload, ct);
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
        var dict = new Dictionary<string, JsonElement>();
        foreach (var p in root.EnumerateObject()) dict[p.Name] = p.Value.Clone();
        dict["model"] = JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(modelId)).RootElement;
        return JsonSerializer.Serialize(dict);
    }
}
