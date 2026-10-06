namespace Hetu.Shared.AI;

/// <summary>
/// models.dev 模型目录中的单条模型信息（用于添加模型时自动填充能力配置）
/// </summary>
public class CatalogModelInfo
{
    public string ProviderId { get; set; } = string.Empty;
    public string ProviderName { get; set; } = string.Empty;
    public string ModelId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Family { get; set; }
    public bool Reasoning { get; set; }
    /// <summary>
    /// 模型支持的推理强度等级（models.dev reasoning_options: effort），如 none/low/medium/high/xhigh/max
    /// </summary>
    public List<string> ReasoningEffortValues { get; set; } = [];
    /// <summary>
    /// 推理 Token 预算下限（models.dev reasoning_options: budget_tokens.min，Claude 风格）
    /// </summary>
    public int? ReasoningBudgetMin { get; set; }
    /// <summary>
    /// 推理仅支持开关切换（models.dev reasoning_options: toggle）
    /// </summary>
    public bool ReasoningToggleOnly { get; set; }
    public bool SupportsVision { get; set; }
    public bool SupportsTools { get; set; }
    public int? ContextWindow { get; set; }
    public int? MaxOutputTokens { get; set; }
    public string? ReleaseDate { get; set; }
}

/// <summary>
/// models.dev 模型目录中的供应商摘要
/// </summary>
public class CatalogProviderInfo
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    /// <summary>官方 API 地址（部分供应商未提供，需手动填写）</summary>
    public string? Api { get; set; }
    /// <summary>官方环境变量名（如 DEEPSEEK_API_KEY）</summary>
    public string? Env { get; set; }
    /// <summary>SDK 包名（用于推断 OpenAI 兼容 / Anthropic 协议）</summary>
    public string? Npm { get; set; }
    /// <summary>官方文档地址</summary>
    public string? Doc { get; set; }
    public int ModelCount { get; set; }
}

/// <summary>
/// models.dev 模型目录中的供应商详情（含全部模型）
/// </summary>
public class CatalogProviderDetail : CatalogProviderInfo
{
    public List<CatalogModelInfo> Models { get; set; } = [];
}
