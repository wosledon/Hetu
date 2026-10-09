using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Work;

namespace Hetu.Core.Services;

/// <summary>
/// Wiki 资料采集：本地项目走文件系统，SSH 远程项目经命令执行器读取远端文件。
/// 产出基础上下文（目录树 + 类型分布 + 关键文件）与源码采样兜底（无代码索引时使用）。
/// </summary>
internal sealed class WikiSourceMaterial
{
    /// <summary>目录树 + 类型分布 + 关键文件内容，每页 prompt 都会带上</summary>
    public string BaseContext { get; init; } = string.Empty;
    /// <summary>源码采样（仅在项目没有可用代码语义索引时使用）</summary>
    public string FallbackSources { get; init; } = string.Empty;
    /// <summary>关联的 Code 工作项目 ID；有值时代码上下文走语义索引</summary>
    public Guid? WorkProjectId { get; init; }
    /// <summary>采集失败原因（目录不存在、远端不可达等）</summary>
    public string? Failure { get; init; }
    /// <summary>是否采集到了可用资料</summary>
    public bool HasContext => !string.IsNullOrWhiteSpace(BaseContext);
}

/// <summary>本地 / 远端项目资料采集与过期判定</summary>
internal static class WikiContextCollector
{
    private const int KeyFilesBudget = 32 * 1024;
    private const int SourceBudget = 24 * 1024;
    private const int MaxSourceFiles = 20;
    private const int SourceFileLimit = 1500;
    private const int MaxTreeDepth = 3;
    private const int MaxTreeEntries = 300;
    private const int MaxScannedFiles = 5000;
    private const int RemoteReadBytes = 8192;

    /// <summary>远端 find 剪枝的内置目录（与本地 <see cref="WorkProjectRules"/> 内置目录保持一致）</summary>
    private static readonly string[] RemoteIgnoredDirNames =
    [
        ".git", ".svn", ".hg", ".vs", ".idea", "node_modules", "bower_components", "vendor",
        "bin", "obj", "dist", "build", "out", "target", "coverage", ".next", ".nuxt",
        ".turbo", ".cache", ".parcel-cache", "venv", ".venv", "__pycache__",
        ".pytest_cache", ".mypy_cache", ".ruff_cache", ".gradle", ".mvn", "packages",
        "TestResults", "artifacts",
    ];

    private static readonly HashSet<string> KeyFileNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "readme", "agents", "claude", "hetu", "contributing", "changelog", "license",
        "package.json", "tsconfig.json", "vite.config.ts", "vite.config.js",
        "pyproject.toml", "requirements.txt", "setup.py", "pipfile",
        "cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts",
        "composer.json", "gemfile", "makefile", "dockerfile",
        "docker-compose.yml", "docker-compose.yaml", ".env.example",
        "appsettings.json", "appsettings.development.json",
    };

    private static readonly HashSet<string> KeyFileExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".csproj", ".sln", ".slnx",
    };

    private static readonly HashSet<string> SourceExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt",
        ".vue", ".svelte", ".rb", ".php", ".swift", ".c", ".h", ".cpp", ".hpp"
    };

    public static async Task<WikiSourceMaterial> CollectAsync(
        ManagedProject project,
        IWorkCommandRunnerFactory runnerFactory,
        IUnitOfWork unitOfWork,
        CancellationToken ct)
    {
        if (project.ProjectType == "Ssh")
            return await CollectRemoteAsync(project, runnerFactory, unitOfWork, ct);
        return CollectLocal(project);
    }

    private static WikiSourceMaterial CollectLocal(ManagedProject project)
    {
        if (!Directory.Exists(project.DirectoryPath))
            return new WikiSourceMaterial { Failure = "项目目录不存在，请检查路径" };

        var files = EnumerateLocalFiles(project.DirectoryPath);
        if (files.Count == 0)
            return new WikiSourceMaterial { Failure = "未能读取到项目资料，目录可能为空或全部被忽略规则过滤" };

        var sb = new StringBuilder();
        sb.AppendLine("## 目录结构（深度不超过 3 层，已忽略构建 / 依赖目录）");
        sb.AppendLine("````");
        sb.AppendLine(BuildLocalTree(project.DirectoryPath));
        sb.AppendLine("````");
        sb.AppendLine();
        sb.AppendLine("## 文件类型分布");
        sb.AppendLine(SummarizeTypes(files));
        sb.AppendLine();
        AppendKeyFiles(sb, project.DirectoryPath, files, (file, max) => ReadLocalHead(file, max));

        return new WikiSourceMaterial
        {
            BaseContext = sb.ToString().Trim(),
            FallbackSources = BuildLocalSourceSamples(project.DirectoryPath, files),
        };
    }

    private static async Task<WikiSourceMaterial> CollectRemoteAsync(
        ManagedProject project,
        IWorkCommandRunnerFactory runnerFactory,
        IUnitOfWork unitOfWork,
        CancellationToken ct)
    {
        var workProject = await FindWorkProjectAsync(project, unitOfWork, ct);
        if (workProject == null)
            return new WikiSourceMaterial { Failure = "未找到关联的 Code 工作项目，无法连接远端目录" };

        IWorkCommandRunner runner;
        try
        {
            runner = runnerFactory.Create(workProject);
        }
        catch (Exception ex)
        {
            return new WikiSourceMaterial { Failure = $"创建远端连接失败：{ex.Message.Split('\n')[0]}" };
        }

        var listing = await runner.RunAsync(BuildRemoteFindCommand(), ct);
        if (listing.ExitCode != 0 || string.IsNullOrWhiteSpace(listing.StdOut))
            return new WikiSourceMaterial { Failure = $"读取远端目录失败：{(string.IsNullOrWhiteSpace(listing.StdErr) ? "未知错误" : listing.StdErr.Split('\n')[0])}" };

        var files = new List<string>();
        foreach (var raw in listing.StdOut.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            var relative = ToRelative(workProject.RootPath, line);
            if (relative == null) continue;
            if (files.Count >= MaxScannedFiles) break;
            files.Add(relative);
        }
        if (files.Count == 0)
            return new WikiSourceMaterial { Failure = "远端目录为空" };

        var sb = new StringBuilder();
        sb.AppendLine("## 目录结构（远端，深度不超过 3 层，已忽略构建 / 依赖目录）");
        sb.AppendLine("````");
        sb.AppendLine(BuildRemoteTree(files));
        sb.AppendLine("````");
        sb.AppendLine();
        sb.AppendLine("## 文件类型分布");
        sb.AppendLine(SummarizeTypes(files.Select(f => f.Replace('\\', '/'))));
        sb.AppendLine();
        await AppendRemoteKeyFilesAsync(sb, runner, files, ct);

        return new WikiSourceMaterial
        {
            BaseContext = sb.ToString().Trim(),
            FallbackSources = await BuildRemoteSourceSamplesAsync(runner, files, ct),
            WorkProjectId = workProject.Id,
        };
    }

    /// <summary>本地项目的关联工作项目（语义索引依赖它）</summary>
    public static async Task<Guid?> FindLocalWorkProjectIdAsync(ManagedProject project, IUnitOfWork unitOfWork, CancellationToken ct)
    {
        var work = (await unitOfWork.WorkProjects.FindAsync(
            w => w.ManagedProjectId == project.Id || w.RootPath == project.DirectoryPath, ct))
            .OrderByDescending(w => w.ManagedProjectId == project.Id)
            .FirstOrDefault();
        return work?.Id;
    }

    private static async Task<WorkProject?> FindWorkProjectAsync(ManagedProject project, IUnitOfWork unitOfWork, CancellationToken ct)
    {
        var work = (await unitOfWork.WorkProjects.FindAsync(
            w => w.ManagedProjectId == project.Id || w.RootPath == project.DirectoryPath, ct))
            .OrderByDescending(w => w.ManagedProjectId == project.Id)
            .FirstOrDefault();
        return work;
    }

    #region 本地

    private static List<string> EnumerateLocalFiles(string root)
    {
        var files = new List<string>();
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0 && files.Count < MaxScannedFiles)
        {
            var dir = stack.Pop();
            string[] subDirs;
            string[] dirFiles;
            try
            {
                subDirs = Directory.GetDirectories(dir);
                dirFiles = Directory.GetFiles(dir);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            foreach (var sub in subDirs)
            {
                if (WorkProjectRules.IsBuiltinIgnoredDir(Path.GetFileName(sub))) continue;
                if (WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, sub))) continue;
                stack.Push(sub);
            }
            foreach (var file in dirFiles)
            {
                if (files.Count >= MaxScannedFiles) break;
                if (WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, file))) continue;
                files.Add(file);
            }
        }
        return files;
    }

    private static string? ReadLocalHead(string file, int maxChars)
    {
        try
        {
            var info = new FileInfo(file);
            if (!info.Exists || info.Length == 0 || info.Length > 1024 * 1024) return null;
            if (!WorkProjectRules.IsProbablyText(file)) return null;
            var text = File.ReadAllText(file);
            if (string.IsNullOrWhiteSpace(text)) return null;
            return text.Length <= maxChars ? text : text[..maxChars] + "\n…（内容过长已截断）";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string BuildLocalSourceSamples(string root, List<string> files)
    {
        var candidates = files
            .Where(f => SourceExtensions.Contains(Path.GetExtension(f)))
            .OrderBy(f => Path.GetRelativePath(root, f), StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (candidates.Count == 0) return string.Empty;

        var picked = Sample(candidates.Select(f => Path.GetRelativePath(root, f)).ToList());
        var sb = new StringBuilder();
        sb.AppendLine($"## 源码采样（{picked.Count} / {candidates.Count} 个代码文件，内容有截断）");
        var budget = SourceBudget;
        foreach (var relative in picked)
        {
            if (budget <= 0)
            {
                sb.AppendLine("…（其余源码已省略）");
                break;
            }
            var text = ReadLocalHead(Path.Combine(root, relative), Math.Min(SourceFileLimit, budget));
            if (text == null) continue;
            budget -= text.Length;
            sb.AppendLine($"### {relative}");
            sb.AppendLine("````");
            sb.AppendLine(text);
            sb.AppendLine("````");
            sb.AppendLine();
        }
        return sb.ToString().Trim();
    }

    private static string BuildLocalTree(string root)
    {
        var sb = new StringBuilder();
        var count = 0;

        void Walk(string dir, int depth)
        {
            if (depth > MaxTreeDepth || count >= MaxTreeEntries) return;
            string[] subDirs;
            string[] dirFiles;
            try
            {
                subDirs = Directory.GetDirectories(dir);
                dirFiles = Directory.GetFiles(dir);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return;
            }

            var entries = new List<(string Name, bool IsDir)>();
            foreach (var sub in subDirs)
            {
                var name = Path.GetFileName(sub);
                if (WorkProjectRules.IsBuiltinIgnoredDir(name)) continue;
                if (WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, sub))) continue;
                entries.Add((name, true));
            }
            foreach (var file in dirFiles)
            {
                var name = Path.GetFileName(file);
                if (WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, file))) continue;
                entries.Add((name, false));
            }
            entries.Sort((a, b) => b.IsDir.CompareTo(a.IsDir) | string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));

            foreach (var (name, isDir) in entries)
            {
                if (count >= MaxTreeEntries)
                {
                    sb.AppendLine($"{new string(' ', (depth + 1) * 2)}…（条目过多已截断）");
                    return;
                }
                count++;
                sb.AppendLine($"{new string(' ', (depth + 1) * 2)}{name}{(isDir ? "/" : "")}");
                if (isDir) Walk(Path.Combine(dir, name), depth + 1);
            }
        }

        Walk(root, 0);
        return sb.ToString().TrimEnd();
    }

    #endregion

    #region 远端

    private static string BuildRemoteFindCommand()
    {
        var prune = string.Join(" -o ", RemoteIgnoredDirNames.Select(n => $"-name {n}"));
        return $"find . -type d \\( {prune} \\) -prune -o -type f -print 2>/dev/null | head -n {MaxScannedFiles}";
    }

    private static async Task<string> ReadRemoteHeadAsync(IWorkCommandRunner runner, string relative, int maxChars, CancellationToken ct)
    {
        var quoted = WorkRemoteFs.Quote(runner.RootPath, relative);
        var result = await runner.RunAsync($"head -c {RemoteReadBytes} {quoted} 2>/dev/null", ct);
        if (result.ExitCode != 0 || string.IsNullOrWhiteSpace(result.StdOut)) return string.Empty;
        var text = result.StdOut;
        return text.Length <= maxChars ? text : text[..maxChars] + "\n…（内容过长已截断）";
    }

    private static async Task AppendRemoteKeyFilesAsync(StringBuilder sb, IWorkCommandRunner runner, List<string> files, CancellationToken ct)
    {
        var keyFiles = files
            .Where(IsKeyFile)
            .OrderBy(f => f.Count(c => c == '/'))
            .ThenBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (keyFiles.Count == 0) return;

        sb.AppendLine("## 关键文件内容（有截断）");
        var budget = KeyFilesBudget;
        foreach (var relative in keyFiles)
        {
            if (budget <= 0)
            {
                sb.AppendLine("…（其余关键文件已省略）");
                break;
            }
            var text = await ReadRemoteHeadAsync(runner, relative, budget, ct);
            if (string.IsNullOrWhiteSpace(text)) continue;
            budget -= text.Length;
            sb.AppendLine($"### {relative}");
            sb.AppendLine("````");
            sb.AppendLine(text);
            sb.AppendLine("````");
            sb.AppendLine();
        }
    }

    private static async Task<string> BuildRemoteSourceSamplesAsync(IWorkCommandRunner runner, List<string> files, CancellationToken ct)
    {
        var candidates = files
            .Where(f => SourceExtensions.Contains(Path.GetExtension(f.Replace('\\', '/'))))
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (candidates.Count == 0) return string.Empty;

        var picked = Sample(candidates);
        var sb = new StringBuilder();
        sb.AppendLine($"## 源码采样（{picked.Count} / {candidates.Count} 个代码文件，内容有截断）");
        var budget = SourceBudget;
        foreach (var relative in picked)
        {
            if (budget <= 0)
            {
                sb.AppendLine("…（其余源码已省略）");
                break;
            }
            var text = await ReadRemoteHeadAsync(runner, relative, Math.Min(SourceFileLimit, budget), ct);
            if (string.IsNullOrWhiteSpace(text)) continue;
            budget -= text.Length;
            sb.AppendLine($"### {relative}");
            sb.AppendLine("````");
            sb.AppendLine(text);
            sb.AppendLine("````");
            sb.AppendLine();
        }
        return sb.ToString().Trim();
    }

    private static string BuildRemoteTree(List<string> files)
    {
        var sb = new StringBuilder();
        var count = 0;
        var root = new TreeNode(string.Empty);

        foreach (var file in files)
        {
            var parts = file.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            var node = root;
            foreach (var part in parts)
            {
                node = node.Children.TryGetValue(part, out var child)
                    ? child
                    : node.Children[part] = new TreeNode(part);
            }
        }

        void Walk(TreeNode node, int depth)
        {
            if (depth > MaxTreeDepth) return;
            var entries = new List<(string Name, bool IsDir)>();
            foreach (var child in node.Children.Values)
                entries.Add((child.Name, child.IsDir()));
            entries.Sort((a, b) => b.IsDir.CompareTo(a.IsDir) | string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));

            foreach (var (name, isDir) in entries)
            {
                if (count >= MaxTreeEntries)
                {
                    sb.AppendLine($"{new string(' ', (depth + 1) * 2)}…（条目过多已截断）");
                    return;
                }
                count++;
                sb.AppendLine($"{new string(' ', (depth + 1) * 2)}{name}{(isDir ? "/" : "")}");
                if (isDir) Walk(node.Children[name], depth + 1);
            }
        }

        Walk(root, 0);
        return sb.ToString().TrimEnd();
    }

    private sealed class TreeNode(string name)
    {
        public string Name { get; } = name;
        public Dictionary<string, TreeNode> Children { get; } = new(StringComparer.Ordinal);
        /// <summary>有子节点即目录（文件路径的中间段天然形成目录节点）</summary>
        public bool IsDir() => Children.Count > 0;
    }

    #endregion

    #region 公共

    private static bool IsKeyFile(string relative)
    {
        var name = Path.GetFileName(relative.Replace('\\', '/'));
        return KeyFileNames.Contains(name)
               || KeyFileNames.Contains(Path.GetFileNameWithoutExtension(name))
               || KeyFileExtensions.Contains(Path.GetExtension(name));
    }

    private static string SummarizeTypes(IEnumerable<string> paths)
    {
        var stats = paths
            .Select(p => Path.GetExtension(p.Replace('\\', '/')).ToLowerInvariant())
            .GroupBy(ext => ext)
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key, StringComparer.Ordinal)
            .Take(12)
            .Select(g => $"{g.Key}({g.Count()})");
        return string.Join("、", stats);
    }

    /// <summary>候选过多时均匀取样，保证覆盖面</summary>
    private static List<string> Sample(List<string> candidates)
    {
        if (candidates.Count <= MaxSourceFiles) return candidates;
        var picked = new List<string>(MaxSourceFiles);
        for (var i = 0; i < MaxSourceFiles; i++)
            picked.Add(candidates[(int)((long)i * candidates.Count / MaxSourceFiles)]);
        return picked;
    }

    private static void AppendKeyFiles(StringBuilder sb, string root, List<string> files, Func<string, int, string?> readHead)
    {
        var keyFiles = files
            .Where(IsKeyFile)
            .OrderBy(f => Path.GetRelativePath(root, f).Count(c => c == Path.DirectorySeparatorChar || c == Path.AltDirectorySeparatorChar))
            .ThenBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (keyFiles.Count == 0) return;

        sb.AppendLine("## 关键文件内容（有截断）");
        var budget = KeyFilesBudget;
        foreach (var file in keyFiles)
        {
            if (budget <= 0)
            {
                sb.AppendLine("…（其余关键文件已省略）");
                break;
            }
            var text = readHead(file, budget);
            if (string.IsNullOrEmpty(text)) continue;
            budget -= text.Length;
            sb.AppendLine($"### {Path.GetRelativePath(root, file)}");
            sb.AppendLine("````");
            sb.AppendLine(text);
            sb.AppendLine("````");
            sb.AppendLine();
        }
    }

    /// <summary>把绝对路径转成项目相对路径；不在项目内返回 null</summary>
    private static string? ToRelative(string root, string absolutePath)
    {
        var path = absolutePath.Trim().TrimEnd('\r');
        if (path.Length == 0) return null;
        var normalizedRoot = root.Trim().TrimEnd('/', '\\');
        if (path.StartsWith("./")) path = path[2..];
        if (path.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            path = Path.GetRelativePath(normalizedRoot, path);
        else if (path.StartsWith("/") || Path.IsPathRooted(path))
            return null;
        var relative = path.Replace('\\', '/').TrimStart('/');
        return relative.Length == 0 ? null : relative;
    }

    #endregion

    #region 过期判定

    /// <summary>
    /// 判定一套 Wiki 是否过期：统计生成时间之后被修改或新增的文件数。
    /// 本地走文件系统；远端用 find -newermt，失败时按未过期处理。
    /// </summary>
    public static async Task<(int StaleFileCount, bool IsStale)> ComputeStaleAsync(
        ManagedProject project,
        IWorkCommandRunnerFactory runnerFactory,
        IUnitOfWork unitOfWork,
        DateTimeOffset generatedAt,
        CancellationToken ct)
    {
        try
        {
            if (project.ProjectType == "Ssh")
                return await ComputeStaleRemoteAsync(project, runnerFactory, unitOfWork, generatedAt, ct);

            if (!Directory.Exists(project.DirectoryPath)) return (0, false);
            var threshold = generatedAt.UtcDateTime;
            var stale = 0;
            foreach (var file in EnumerateLocalFiles(project.DirectoryPath))
            {
                try
                {
                    if (File.GetLastWriteTimeUtc(file) > threshold) stale++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // 单个文件不可读不影响整体判定
                }
            }
            return (stale, stale > 0);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return (0, false);
        }
    }

    private static async Task<(int StaleFileCount, bool IsStale)> ComputeStaleRemoteAsync(
        ManagedProject project,
        IWorkCommandRunnerFactory runnerFactory,
        IUnitOfWork unitOfWork,
        DateTimeOffset generatedAt,
        CancellationToken ct)
    {
        var workProject = await FindWorkProjectAsync(project, unitOfWork, ct);
        if (workProject == null) return (0, false);
        var runner = runnerFactory.Create(workProject);
        var iso = generatedAt.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss");
        var prune = string.Join(" -o ", RemoteIgnoredDirNames.Select(n => $"-name {n}"));
        var command = $"find . -type d \\( {prune} \\) -prune -o -type f -newermt '{iso}' -print 2>/dev/null | wc -l";
        var result = await runner.RunAsync(command, ct);
        if (result.ExitCode != 0) return (0, false);
        var count = int.TryParse(result.StdOut.Trim(), out var parsed) ? parsed : 0;
        return (count, count > 0);
    }

    #endregion
}
