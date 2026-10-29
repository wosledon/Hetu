namespace Hetu.Core.Entities;

/// <summary>
/// 白板画板：用于绘制与演示架构图等示意图。整个场景（元素 + 视口）以 JSON 形式存储。
/// </summary>
public class Whiteboard : BaseEntity
{
    /// <summary>画板名称</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>JSON: 画板场景（elements 元素数组 + viewport 视口）</summary>
    public string Scene { get; set; } = "{}";

    /// <summary>是否软删除</summary>
    public bool IsDeleted { get; set; }
}
