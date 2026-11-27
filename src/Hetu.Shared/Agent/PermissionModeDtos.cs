namespace Hetu.Shared.Agent;

/// <summary>Agent 权限模式选项：值、名称与说明均由后端下发，前端直接渲染。</summary>
public class AgentPermissionModeDto
{
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}