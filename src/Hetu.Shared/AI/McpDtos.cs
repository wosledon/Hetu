namespace Hetu.Shared.AI;

public class McpServerDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string ConnectionConfig { get; set; } = string.Empty;
    public bool IsEnabled { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateMcpServerRequest
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Type { get; set; } = "stdio";
    public string ConnectionConfig { get; set; } = string.Empty;
}

public class UpdateMcpServerRequest
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Type { get; set; } = "stdio";
    public string ConnectionConfig { get; set; } = string.Empty;
    public bool IsEnabled { get; set; }
    public int SortOrder { get; set; }
}

public class McpToolDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public object? InputSchema { get; set; }
}

public class CallMcpToolRequest
{
    public string ToolName { get; set; } = string.Empty;
    public Dictionary<string, object>? Arguments { get; set; }
}

public class CallMcpToolResultDto
{
    public string Content { get; set; } = string.Empty;
    public bool IsError { get; set; }
}
