namespace Hetu.Api.Hosting;

/// <summary>
/// 解析 Hetu 数据目录（SQLite 数据库、日志等落盘位置）。
/// 优先级：<c>Hetu:DataDir</c> 配置 → <c>HETU_DATA_DIR</c> 环境变量 → OS 本地应用数据目录。
/// </summary>
public static class DataDirectoryResolver
{
    public static string Resolve(IConfiguration configuration)
    {
        var configured = new[]
        {
            configuration["Hetu:DataDir"],
            Environment.GetEnvironmentVariable("HETU_DATA_DIR"),
        }.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

        if (configured != null)
            return Path.GetFullPath(Environment.ExpandEnvironmentVariables(configured));

        // Windows: %LOCALAPPDATA%/Hetu
        // Linux:   ~/.local/share/Hetu
        // macOS:   ~/Library/Application Support/Hetu
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
            localAppData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".hetu");

        return Path.Combine(localAppData, "Hetu");
    }
}
