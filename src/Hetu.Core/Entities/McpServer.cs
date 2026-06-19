namespace Hetu.Core.Entities;

public class McpServer : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Type { get; set; } = "stdio"; // stdio or sse
    public string ConnectionConfig { get; set; } = string.Empty; // JSON: command/args/env or url
    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; }
}
