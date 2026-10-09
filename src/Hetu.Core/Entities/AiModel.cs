namespace Hetu.Core.Entities;

public class AiModel : BaseEntity
{
    public Guid ProviderId { get; set; }
    public AiProvider Provider { get; set; } = null!;
    public string ModelId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Purpose { get; set; } = "chat";
    public bool IsDefault { get; set; }
    public int? ContextWindow { get; set; }
    public int? Dimensions { get; set; }
    /// <summary>
    /// 推理模式: none=不支持, tag=标签模式(&lt;thinking&gt;), native=原生(o1/Claude)
    /// </summary>
    public string ReasoningMode { get; set; } = "none";
    /// <summary>
    /// 推理强度: off/none/minimal/low/medium/high/xhigh/max 或供应商自定义字符串
    /// </summary>
    public string ReasoningEffort { get; set; } = "medium";
    /// <summary>
    /// 可选推理强度档位（逗号分隔，来自 models.dev 的 reasoning_options.effort）；
    /// 为空时按内置三档（低/中/高）处理
    /// </summary>
    public string? ReasoningEfforts { get; set; }
    /// <summary>
    /// 推理 Token 预算（Claude budget_tokens 风格；为空时按强度等级由 Provider 换算）
    /// </summary>
    public int? ReasoningBudgetTokens { get; set; }
    /// <summary>
    /// 是否支持视觉（图像理解）
    /// </summary>
    public bool SupportsVision { get; set; }
    /// <summary>
    /// 是否支持推理（思维链）
    /// </summary>
    public bool SupportsReasoning { get; set; }
    /// <summary>
    /// 是否支持工具调用（Function Calling）
    /// </summary>
    public bool SupportsTools { get; set; }
    /// <summary>
    /// 是否在 UI 中可见
    /// </summary>
    public bool IsVisible { get; set; } = true;
}
