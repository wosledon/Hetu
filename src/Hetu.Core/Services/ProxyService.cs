using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;

namespace Hetu.Core.Services;

/// <summary>
/// 代理服务：按固定配置（route / shadow）解析最终目标模型键。
/// </summary>
public class ProxyService
{
    private readonly ModelKeyResolver _resolver;
    private readonly ProxyRouteClassifier _classifier;
    private readonly ILLMProviderFactory _llmFactory;
    private readonly ProxyConfigService _config;

    public ProxyService(ModelKeyResolver resolver, ProxyRouteClassifier classifier, ILLMProviderFactory llmFactory, ProxyConfigService config)
    {
        _resolver = resolver;
        _classifier = classifier;
        _llmFactory = llmFactory;
        _config = config;
    }

    /// <summary>按对外 modelKey 找到对应的代理配置（route 或 shadow）。</summary>
    public async Task<ProxyConfigDto?> GetByModelKeyAsync(string modelKey, CancellationToken ct)
    {
        var route = await _config.GetAsync("route", ct);
        if (route.ModelKey == modelKey) return route;
        var shadow = await _config.GetAsync("shadow", ct);
        if (shadow.ModelKey == modelKey) return shadow;
        return null;
    }

    /// <summary>按模式解析本次请求的目标模型复合键。</summary>
    public async Task<string?> ResolveTargetModelKeyAsync(ProxyConfigDto config, string userText, CancellationToken ct)
    {
        if (config.Mode == "shadow")
            return config.ShadowTargetModelKey;

        // 路由模式：LLM 分类优先，降级规则启发
        string category;
        if (!string.IsNullOrWhiteSpace(config.RouteClassifierModelKey))
        {
            var classifierResolved = await _resolver.ResolveAsync(config.RouteClassifierModelKey, ct);
            ILLMProvider? classifierProvider = null;
            if (classifierResolved != null)
                classifierProvider = await _llmFactory.CreateProviderAsync(classifierResolved.Value.model.Id, ct);

            if (classifierProvider != null)
                category = await _classifier.ClassifyByLlmAsync(classifierProvider, userText, ct) ?? _classifier.ClassifyByRules(userText);
            else
                category = _classifier.ClassifyByRules(userText);
        }
        else
        {
            category = _classifier.ClassifyByRules(userText);
        }

        var rule = config.RouteRules.FirstOrDefault(r => r.Category == category)
                   ?? config.RouteRules.FirstOrDefault(r => r.Category == "default");
        return rule?.TargetModelKey;
    }
}
