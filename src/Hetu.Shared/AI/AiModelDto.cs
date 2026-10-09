namespace Hetu.Shared.AI;

public class AiModelDto
{
    public Guid Id { get; set; }
    public Guid ProviderId { get; set; }
    public string ModelId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Purpose { get; set; } = "chat";
    public bool IsDefault { get; set; }
    public int? ContextWindow { get; set; }
    public int? Dimensions { get; set; }
    public string ReasoningMode { get; set; } = "none";
    public string ReasoningEffort { get; set; } = "medium";
    /// <summary>可选推理强度档位（逗号分隔，来自模型目录），决定对话/Code 选择器的候选项</summary>
    public string? ReasoningEfforts { get; set; }
    public int? ReasoningBudgetTokens { get; set; }
    public bool SupportsVision { get; set; }
    public bool SupportsReasoning { get; set; }
    public bool SupportsTools { get; set; }
    public bool IsVisible { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateAiModelRequest
{
    public Guid ProviderId { get; set; }
    public string ModelId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Purpose { get; set; } = "chat";
    public bool IsDefault { get; set; }
    public int? ContextWindow { get; set; }
    public int? Dimensions { get; set; }
    public string ReasoningMode { get; set; } = "none";
    public string ReasoningEffort { get; set; } = "medium";
    /// <summary>可选推理强度档位（逗号分隔）</summary>
    public string? ReasoningEfforts { get; set; }
    public int? ReasoningBudgetTokens { get; set; }
    public bool SupportsVision { get; set; }
    public bool SupportsReasoning { get; set; }
    public bool SupportsTools { get; set; }
    public bool IsVisible { get; set; } = true;
}

public class UpdateAiModelRequest
{
    public string ModelId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Purpose { get; set; } = "chat";
    public bool IsDefault { get; set; }
    public int? ContextWindow { get; set; }
    public int? Dimensions { get; set; }
    public string ReasoningMode { get; set; } = "none";
    public string ReasoningEffort { get; set; } = "medium";
    /// <summary>可选推理强度档位（逗号分隔）</summary>
    public string? ReasoningEfforts { get; set; }
    public int? ReasoningBudgetTokens { get; set; }
    public bool SupportsVision { get; set; }
    public bool SupportsReasoning { get; set; }
    public bool SupportsTools { get; set; }
    public bool IsVisible { get; set; } = true;
}

/// <summary>
/// 自动获取到的远程模型信息
/// </summary>
public class RemoteModelInfo
{
    public string ModelId { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public int? ContextWindow { get; set; }
}
