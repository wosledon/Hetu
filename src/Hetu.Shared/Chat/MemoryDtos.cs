namespace Hetu.Shared.Chat;

public class MemoryDto
{
    public Guid Id { get; set; }
    public string Content { get; set; } = string.Empty;
    public string Source { get; set; } = "conversation";
    public Guid? TopicId { get; set; }
    public string? Category { get; set; }
    public float Importance { get; set; }
    public int AccessCount { get; set; }
    public DateTimeOffset LastAccessedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    /// <summary>检索时的综合得分（仅在检索结果中填充）</summary>
    public double? Score { get; set; }
}

public class CreateMemoryRequest
{
    public string Content { get; set; } = string.Empty;
    public string? Category { get; set; }
    public float Importance { get; set; } = 0.5f;
}

public class UpdateMemoryRequest
{
    public string Content { get; set; } = string.Empty;
    public string? Category { get; set; }
    public float Importance { get; set; }
}

public class MemorySearchRequest
{
    public string Query { get; set; } = string.Empty;
    public int TopK { get; set; } = 10;
}
