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
    /// 推理强度: off/low/medium/high（仅 native 模式使用）
    /// </summary>
    public string ReasoningEffort { get; set; } = "medium";
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
