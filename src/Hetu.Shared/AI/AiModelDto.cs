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
}
