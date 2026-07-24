namespace Hetu.Shared.Chat;

/// <summary>固定代理配置（route / shadow 两种，存 AppSettings）</summary>
public class ProxyConfigDto
{
    public string Mode { get; set; } = "shadow";
    public string ModelKey { get; set; } = string.Empty;
    public string? ShadowTargetModelKey { get; set; }
    public string? RouteClassifierModelKey { get; set; }
    public List<ProxyRouteRuleDto> RouteRules { get; set; } = new();
}

public class ProxyRouteRuleDto
{
    public Guid Id { get; set; }
    public string Category { get; set; } = "default";
    public string TargetModelKey { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}
