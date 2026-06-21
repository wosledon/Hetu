namespace Hetu.Core.Entities;

public class PromptPreset : BaseEntity
{
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Variables { get; set; }
    /// <summary>
    /// JSON: { variables: string[], tools: string[], toolApprovals: Record&lt;string, string&gt; }
    /// </summary>
    public string? ToolsConfig { get; set; }
    public bool IsBuiltIn { get; set; }
    public int SortOrder { get; set; }
}
