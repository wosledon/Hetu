namespace Hetu.Core.Services.Tools;

/// <summary>
/// 工具功能分组：工具页归类、系统提示里的「按需加载」索引、load_tools 按组加载共用同一套映射。
/// </summary>
public static class ToolGroupMap
{
    /// <summary>分组展示顺序（提示词索引与工具页一致，便于模型按组查找）</summary>
    public static readonly string[] Order =
    [
        "通用", "笔记", "笔记本", "标签", "知识库", "知识图谱", "记忆", "联网",
        "项目", "任务看板", "工作流", "智能体", "技能", "定时任务", "收件箱", "用量",
        "Wiki", "工作区与命令", "其他",
    ];

    /// <summary>按名称推断功能分组</summary>
    public static string Resolve(string name)
    {
        if (name.StartsWith("work_", StringComparison.OrdinalIgnoreCase)) return "工作区与命令";
        if (name.Contains("notebook", StringComparison.OrdinalIgnoreCase)) return "笔记本";
        if (name.Contains("note", StringComparison.OrdinalIgnoreCase)) return "笔记";
        if (name.Contains("tag", StringComparison.OrdinalIgnoreCase)) return "标签";
        if (name.Contains("memor", StringComparison.OrdinalIgnoreCase)) return "记忆";
        if (name.Contains("graph", StringComparison.OrdinalIgnoreCase)) return "知识图谱";
        if (name.Contains("knowledge", StringComparison.OrdinalIgnoreCase)) return "知识库";
        if (name.Contains("scheduled", StringComparison.OrdinalIgnoreCase)) return "定时任务";
        if (name.Contains("kanban", StringComparison.OrdinalIgnoreCase)) return "任务看板";
        if (name.Contains("wiki", StringComparison.OrdinalIgnoreCase)) return "Wiki";
        if (name.Contains("workflow", StringComparison.OrdinalIgnoreCase)) return "工作流";
        if (name.Contains("agent", StringComparison.OrdinalIgnoreCase)) return "智能体";
        if (name.Contains("skill", StringComparison.OrdinalIgnoreCase)) return "技能";
        if (name.Contains("project", StringComparison.OrdinalIgnoreCase)) return "项目";
        if (name.Contains("inbox", StringComparison.OrdinalIgnoreCase)) return "收件箱";
        if (name.Contains("usage", StringComparison.OrdinalIgnoreCase)) return "用量";
        if (name.Contains("web", StringComparison.OrdinalIgnoreCase)) return "联网";
        return "通用";
    }
}
