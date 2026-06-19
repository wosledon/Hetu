namespace Hetu.Core.Entities;

public class AiProvider : BaseEntity
{
    public string ProviderType { get; set; } = "openai";
    public string Name { get; set; } = string.Empty;
    public string EncryptedApiKey { get; set; } = string.Empty;
    public string? BaseUrl { get; set; }
    public bool IsEnabled { get; set; } = true;
    public List<AiModel> Models { get; set; } = [];
}
