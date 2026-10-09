namespace Hetu.Shared.AI;

/// <summary>内置工具目录项（工具页展示用）</summary>
public class ToolCatalogItemDto
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    /// <summary>使用指引（何时用、与其他工具如何协作），空表示未定义</summary>
    public string? UsageGuideline { get; set; }
    /// <summary>风险等级：read（只读）/ write（写入）/ execute（执行命令）</summary>
    public string Risk { get; set; } = "write";
    /// <summary>默认审批：auto（直接执行）/ ask（需确认）/ bypass</summary>
    public string DefaultApproval { get; set; } = "ask";
    /// <summary>功能分组（笔记 / 记忆 / 工作区文件 / 任务看板 ...）</summary>
    public string Group { get; set; } = "其他";
    /// <summary>可用的会话人格：knowledge（知识助手）/ work（Code）/ desktop / cowork</summary>
    public List<string> Profiles { get; set; } = [];
    /// <summary>参数 JSON Schema（原样返回，前端可展开查看）</summary>
    public string? ParametersSchema { get; set; }
}
