namespace Hetu.Shared.Settings;

/// <summary>
/// Code 工作树位置配置：工作树放哪由这里决定，软件自己在该目录下按「仓库名/工作树名」管理子目录。
/// 留空 = 默认（仓库父目录下的 <c>.hetu-worktrees</c> 统一存放，父目录里只有这一个文件夹）。
/// </summary>
public class WorktreeConfigDto
{
    /// <summary>工作树根目录；留空 = 仓库父目录下的 .hetu-worktrees</summary>
    public string? RootDirectory { get; set; }

    /// <summary>实际生效的根目录示例（按第一个本地项目算，只读展示）</summary>
    public string? ExampleRoot { get; set; }

    /// <summary>实际生效的工作树路径示例（按第一个本地项目算，只读展示）</summary>
    public string? ExamplePath { get; set; }
}
