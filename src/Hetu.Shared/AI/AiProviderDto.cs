namespace Hetu.Shared.AI;

public class AiProviderDto
{
    public Guid Id { get; set; }
    public string ProviderType { get; set; } = "openai";
    public string Name { get; set; } = string.Empty;
    public string? BaseUrl { get; set; }
    public bool IsEnabled { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public List<AiModelDto> Models { get; set; } = [];
}

public class CreateAiProviderRequest
{
    public string ProviderType { get; set; } = "openai";
    public string Name { get; set; } = string.Empty;
    public string? ApiKey { get; set; }
    public string? BaseUrl { get; set; }
    public bool IsEnabled { get; set; } = true;
}

public class UpdateAiProviderRequest
{
    public string ProviderType { get; set; } = "openai";
    public string Name { get; set; } = string.Empty;
    public string? ApiKey { get; set; }
    public string? BaseUrl { get; set; }
    public bool IsEnabled { get; set; } = true;
}
