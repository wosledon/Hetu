namespace Hetu.Shared.Whiteboard;

/// <summary>
/// 白板画板：含完整场景 JSON
/// </summary>
public class WhiteboardDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Scene { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// 白板画板列表项：不含场景正文，避免列表接口拉取全量 JSON
/// </summary>
public class WhiteboardListItemDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateWhiteboardRequest
{
    public string Name { get; set; } = string.Empty;
    public string Scene { get; set; } = "{}";
}

public class UpdateWhiteboardRequest
{
    /// <summary>画板名称；为空表示保持不变</summary>
    public string? Name { get; set; }

    /// <summary>画板场景 JSON；为空表示保持不变</summary>
    public string? Scene { get; set; }
}
