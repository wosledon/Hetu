namespace Hetu.Shared.AI;

public class AgentDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string SystemPrompt { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public List<string> ToolNames { get; set; } = new();
    public List<Guid> McpServerIds { get; set; } = new();
    public List<Guid> SkillIds { get; set; } = new();
    public Dictionary<string, string> ToolApprovals { get; set; } = new();
    public int MaxToolCallsPerTurn { get; set; } = 5;
    public int MaxAgentIterations { get; set; } = 15;
    public bool IsEnabled { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateAgentRequest
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string SystemPrompt { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public List<string> ToolNames { get; set; } = new();
    public List<Guid> McpServerIds { get; set; } = new();
    public List<Guid> SkillIds { get; set; } = new();
    public Dictionary<string, string> ToolApprovals { get; set; } = new();
    public int MaxToolCallsPerTurn { get; set; } = 5;
    public int MaxAgentIterations { get; set; } = 15;
    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; }
}

public class UpdateAgentRequest : CreateAgentRequest { }
