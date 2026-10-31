namespace Hetu.Core.Interfaces;

/// <summary>
/// Foundry Local 的本地路径配置。DataDir 由 Program.cs 从配置/环境变量解析后注入，
/// 与 SQLite、日志同一套优先级（Hetu:DataDir → HETU_DATA_DIR → OS 本地应用数据目录）。
/// </summary>
public sealed class FoundryLocalOptions
{
    /// <summary>Hetu 数据目录；模型默认保存到其下的 foundry-models</summary>
    public string DataDir { get; set; } = string.Empty;

    /// <summary>默认模型保存路径</summary>
    public string DefaultModelDir =>
        string.IsNullOrWhiteSpace(DataDir)
            ? Path.Combine(Path.GetTempPath(), "hetu-foundry-models")
            : Path.Combine(DataDir, "foundry-models");
}
