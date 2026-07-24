using System.Text;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.DataProtection;

namespace Hetu.Core.Services;

/// <summary>
/// 单链路代理转发：把代理端点收到的请求体重写 model 后，原样转发到目标真实供应商，
/// 并流式透传响应。不做 OpenAI/Anthropic 协议互转。
/// </summary>
public class ProxyForwarder
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IDataProtector _protector;
    private readonly ModelKeyResolver _resolver;

    public ProxyForwarder(IHttpClientFactory httpClientFactory, IDataProtectionProvider dataProtectionProvider, ModelKeyResolver resolver)
    {
        _httpClientFactory = httpClientFactory;
        _protector = dataProtectionProvider.CreateProtector("Hetu.AiProvider.ApiKey");
        _resolver = resolver;
    }

    /// <summary>解析目标模型键为可直接转发的目标。</summary>
    public async Task<ProxyTarget?> ResolveTargetAsync(string? modelKey, string requiredProtocol, CancellationToken ct)
    {
        var resolved = await _resolver.ResolveAsync(modelKey, ct);
        if (resolved == null) return null;
        var (provider, model) = resolved.Value;
        var protocol = provider.ProviderType.ToLowerInvariant();
        if (protocol != requiredProtocol) return null;

        var baseUrl = string.IsNullOrWhiteSpace(provider.BaseUrl)
            ? GetDefaultBaseUrl(protocol)
            : provider.BaseUrl.TrimEnd('/');
        var apiKey = _protector.Unprotect(provider.EncryptedApiKey);
        return new ProxyTarget(baseUrl, apiKey, model.ModelId, protocol);
    }

    /// <summary>转发请求并返回上游响应（调用方负责流式拷贝与释放）。</summary>
    public async Task<HttpResponseMessage> ForwardStreamAsync(ProxyTarget target, string path, string requestBodyJson, CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, target.BaseUrl + path)
        {
            Content = new StringContent(requestBodyJson, Encoding.UTF8, "application/json"),
        };
        ApplyAuth(request, target);

        return await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
    }

    private static void ApplyAuth(HttpRequestMessage request, ProxyTarget target)
    {
        if (target.Protocol == "anthropic")
        {
            request.Headers.Add("x-api-key", target.ApiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");
        }
        else
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", target.ApiKey);
        }
    }

    private static string GetDefaultBaseUrl(string protocol) => protocol switch
    {
        "anthropic" => "https://api.anthropic.com/v1",
        _ => "https://api.openai.com/v1",
    };
}

public record ProxyTarget(string BaseUrl, string ApiKey, string ModelId, string Protocol);
