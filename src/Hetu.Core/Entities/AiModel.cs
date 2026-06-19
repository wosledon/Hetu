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
}
