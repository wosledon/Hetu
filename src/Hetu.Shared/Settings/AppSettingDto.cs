namespace Hetu.Shared.Settings;

public class AppSettingDto
{
    public string Key { get; set; } = string.Empty;
    public string? Value { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class UpdateAppSettingRequest
{
    public string Key { get; set; } = string.Empty;
    public string? Value { get; set; }
}

public class AppSettingsSnapshotDto
{
    public string AppName { get; set; } = "Hetu";
    public string AssistantName { get; set; } = "AI 助手";
    /// <summary>助手人设/性格描述，拼入 system prompt 用于身份认知</summary>
    public string AssistantPersona { get; set; } = string.Empty;
    public string Theme { get; set; } = "system";
    /// <summary>界面语言：zh 或 en</summary>
    public string Language { get; set; } = "zh";
    public string GraphAutoExtract { get; set; } = "false";
    public string AutoEmbedding { get; set; } = "false";
    /// <summary>默认对话模型 ID</summary>
    public string? DefaultChatModelId { get; set; }
    /// <summary>默认文档 Chunk 模型 ID（用于知识库分块总结）</summary>
    public string? DefaultChunkModelId { get; set; }
    /// <summary>快速模型 ID（用于轻量级任务）</summary>
    public string? DefaultFastModelId { get; set; }
    /// <summary>默认 Embedding 模型 ID</summary>
    public string? DefaultEmbeddingModelId { get; set; }
    /// <summary>上下文窗口消息数（null 表示不限制）</summary>
    public int? ContextWindowSize { get; set; }
    /// <summary>导航菜单项（JSON 数组字符串，如 '["/tags","/graph"]'）</summary>
    public string PinnedNavItems { get; set; } = "[]";
    /// <summary>二级菜单样式：flat 或 collapsed</summary>
    public string SecondaryMenuStyle { get; set; } = "flat";
    /// <summary>主导航菜单样式：top（顶部横栏）或 vertical（左侧垂直胶囊）</summary>
    public string NavStyle { get; set; } = "top";
    /// <summary>关闭主窗口时最小化到系统托盘、保持后台运行（仅桌面客户端生效）</summary>
    public string CloseToTray { get; set; } = "true";
}

public class DatabaseConnectionRequest
{
    public string Provider { get; set; } = "Sqlite";
    public string ConnectionString { get; set; } = string.Empty;
}

public class DatabaseConnectionTestResult
{
    public bool CanConnect { get; set; }
    public bool VectorExtensionAvailable { get; set; }
    public string? Message { get; set; }
}
