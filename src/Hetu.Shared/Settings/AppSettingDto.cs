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
