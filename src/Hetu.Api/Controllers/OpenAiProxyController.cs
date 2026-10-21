using System.Text.Json;
using System.Text.Json.Nodes;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Utilities;
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
    /// <summary>超过该长度的消息内容才走压缩</summary>
    private const int CompressionThreshold = 100;

    private readonly ProxyService _proxyService;
    private readonly ProxyForwarder _forwarder;
    private readonly CompressionPipelineService _compression;
    private readonly ILlmUsageRecorder _usage;

    public OpenAiProxyController(ProxyService proxyService, ProxyForwarder forwarder, CompressionPipelineService compression, ILlmUsageRecorder usage)
    {
        _proxyService = proxyService;
        _forwarder = forwarder;
        _compression = compression;
        _usage = usage;
    }

    /// <summary>
    /// OpenAI 兼容的模型列表。客户端接入前先拉这个端点挑模型，
    /// 这里只暴露代理的虚拟模型键（hetu-route / hetu-shadow）。
    /// </summary>
    [HttpGet("models")]
    public async Task<IActionResult> Models(CancellationToken ct)
    {
        var configs = await _proxyService.GetAllAsync(ct);
        var data = configs
            .Where(c => !string.IsNullOrWhiteSpace(c.ModelKey))
            .Select(c => new
            {
                id = c.ModelKey,
                @object = "model",
                created = 0L,
                owned_by = "hetu",
            });
        return Ok(new { @object = "list", data });
    }

    [HttpPost("chat/completions")]
    public async Task ChatCompletions(CancellationToken ct)
    {
        try
        {
            await ChatCompletionsCoreAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // 客户端主动断开，无需再写错误响应
        }
        catch (Exception ex)
        {
            // 上游不可达 / 解析失败统一转成 OpenAI 错误结构，不向客户端泄漏堆栈
            if (!Response.HasStarted)
                await WriteError($"proxy forward failed: {ex.Message}", 502);
        }
    }

    private async Task ChatCompletionsCoreAsync(CancellationToken ct)
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
        var inputLen = ExtractMessagesLength(root);
        payloadJson = await CompressMessagesInPayload(payloadJson, ct);
        var compressedLen = ExtractMessagesLength(payloadJson);

        // 走统一用量记录器：早期实现写 ChatMessages 且 topicId 用 Guid.Empty，
        // 话题不存在时 SaveAssistantMessageAsync 直接返回 null，用量统计页一条都看不到
        await _usage.RecordAsync(
            source: LlmUsageSources.Proxy,
            usage: null,
            refId: null,
            modelId: null,
            inputTokens: inputLen > 0 ? (int)Math.Ceiling(inputLen / 3.0) : null,
            compressedTokens: compressedLen > 0 ? (int)Math.Ceiling(compressedLen / 3.0) : null,
            contentPreview: $"[proxy:{modelKey}]",
            ct: ct);

        var streaming = root.TryGetProperty("stream", out var s) && s.ValueKind == JsonValueKind.True;
        using var upstream = await _forwarder.ForwardStreamAsync(target, "/chat/completions", payloadJson, ct);
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
            // 非流式请求原样透传上游 Content-Type：一律标成 text/event-stream 时，
            // 客户端会按 SSE 解析 JSON 响应体而失败
            output.ContentType = upstream.Content.Headers.ContentType?.ToString() ?? "application/json";
        }

        await using var stream = await upstream.Content.ReadAsStreamAsync(ct);
        await stream.CopyToAsync(output.Body, ct);
    }

    private async Task WriteError(string message, int statusCode = 400)
    {
        Response.StatusCode = statusCode;
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

    /// <summary>
    /// 压缩 messages 里的长文本内容。只替换字符串型 content，其余值（数组 / 对象 / 数字 / 布尔）原样保留。
    /// 早期实现把所有值降级成字符串，多模态 content、tools、tool_calls 会被破坏成 JSON 字符串，上游直接 400。
    /// 用算法压缩而非 CompressAsync：转发是透传语义，不该为每条消息再打一次 LLM。
    /// </summary>
    private async Task<string> CompressMessagesInPayload(string json, CancellationToken ct)
    {
        if (JsonNode.Parse(json) is not JsonObject root || root["messages"] is not JsonArray messages)
            return json;

        foreach (var message in messages)
        {
            if (message is not JsonObject obj) continue;
            // 数组 / 对象型 content（多模态、content blocks）不动
            if (obj["content"] is not JsonValue content) continue;
            if (!content.TryGetValue<string>(out var text) || text.Length <= CompressionThreshold) continue;

            try
            {
                obj["content"] = await _compression.CompressAlgorithmicAsync(text, ct);
            }
            catch
            {
                // 压缩失败不能阻断转发，保留原文
            }
        }

        return root.ToJsonString();
    }

    private static int ExtractMessagesLength(string json)
    {
        try { using var doc = JsonDocument.Parse(json); return ExtractMessagesLength(doc.RootElement); }
        catch { return 0; }
    }

    private static int ExtractMessagesLength(JsonElement root)
    {
        if (!root.TryGetProperty("messages", out var msgs) || msgs.ValueKind != JsonValueKind.Array)
            return 0;
        return msgs.EnumerateArray()
            .Where(m => m.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String)
            .Sum(m => m.GetProperty("content").GetString()?.Length ?? 0);
    }
}
