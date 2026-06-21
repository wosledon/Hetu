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
    public string Theme { get; set; } = "system";
    public string GraphAutoExtract { get; set; } = "false";
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
