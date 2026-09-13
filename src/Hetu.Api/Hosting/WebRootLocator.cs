namespace Hetu.Api.Hosting;

/// <summary>
/// 定位打包后的前端 wwwroot 目录。
/// sidecar 单文件部署时物理文件由 Tauri resources 安装，位置因打包器而异
/// （exe 同目录 / exe 上一级的 resources 子目录等），而默认 ContentRoot 是进程工作目录，
/// 不一定等于 exe 目录，因此需要逐个候选位置探测。
/// </summary>
public static class WebRootLocator
{
    private static readonly string[] CandidateRelativePaths =
    [
        "wwwroot",
        Path.Combine("binaries", "wwwroot"),
        Path.Combine("..", "wwwroot"),
        Path.Combine("..", "binaries", "wwwroot"),
        Path.Combine("..", "resources", "wwwroot"),
        Path.Combine("..", "resources", "binaries", "wwwroot"),
    ];

    /// <summary>返回包含 index.html 的 wwwroot 绝对路径；未打包时返回 <c>null</c>（dev 模式）。</summary>
    public static string? Locate()
    {
        var exeDir = AppContext.BaseDirectory;

        return CandidateRelativePaths
            .Select(relative => Path.GetFullPath(Path.Combine(exeDir, relative)))
            .FirstOrDefault(candidate => File.Exists(Path.Combine(candidate, "index.html")));
    }
}
