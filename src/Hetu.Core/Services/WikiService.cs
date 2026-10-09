using System.Text;
using System.Text.RegularExpressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;

namespace Hetu.Core.Services;

/// <summary>
/// 项目 Wiki 生成服务：读取本地项目目录的关键资料（目录树 / 说明与清单文件 / 源码采样），
/// 交给 LLM 产出结构化中文 Markdown Wiki 文档并落库。
/// </summary>
public class WikiService : IWikiService
{
    /// <summary>说明 / 清单类文件内容总预算</summary>
    private const int KeyFilesBudget = 32 * 1024;
    /// <summary>源码采样内容总预算</summary>
    private const int SourceBudget = 24 * 1024;
    /// <summary>源码采样文件数上限</summary>
    private const int MaxSourceFiles = 20;
    /// <summary>采样源码单文件字符上限</summary>
    private const int SourceFileLimit = 1500;
    /// <summary>目录树最大深度</summary>
    private const int MaxTreeDepth = 3;
    /// <summary>目录树条目上限</summary>
    private const int MaxTreeEntries = 300;
    /// <summary>全量扫描文件数上限（超出后停止收集）</summary>
    private const int MaxScannedFiles = 5000;

    /// <summary>说明 / 依赖清单类文件名（完整名或不含扩展名命中均可）</summary>
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

    /// <summary>说明 / 依赖清单类扩展名</summary>
    private static readonly HashSet<string> KeyFileExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".csproj", ".sln", ".slnx",
    };

    /// <summary>参与源码采样的扩展名</summary>
    private static readonly HashSet<string> SourceExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt",
        ".vue", ".svelte", ".rb", ".php", ".swift", ".c", ".h", ".cpp", ".hpp"
    };

    private const string WikiSystemPrompt =
        "你是资深项目文档工程师，擅长阅读代码仓库并撰写准确、清晰的中文技术文档。";

    private readonly IUnitOfWork _unitOfWork;
    private readonly ILLMProviderFactory _llmProviderFactory;

    public WikiService(IUnitOfWork unitOfWork, ILLMProviderFactory llmProviderFactory)
    {
        _unitOfWork = unitOfWork;
        _llmProviderFactory = llmProviderFactory;
    }

    public async Task<ApiResponse<List<WikiDocumentDto>>> GetAllAsync(Guid? projectId, CancellationToken cancellationToken = default)
    {
        var docs = await _unitOfWork.WikiDocuments.GetAllAsync(cancellationToken);
        var projects = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        var projectNames = projects.ToDictionary(p => p.Id, p => p.Name);
        var query = docs.AsEnumerable();
        if (projectId is Guid pid) query = query.Where(d => d.ProjectId == pid);
        return ApiResponse<List<WikiDocumentDto>>.Ok(query
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => Map(d, projectNames.GetValueOrDefault(d.ProjectId)))
            .ToList());
    }

    public async Task<ApiResponse<WikiDocumentDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var doc = await _unitOfWork.WikiDocuments.GetByIdAsync(id, cancellationToken);
        if (doc == null) return ApiResponse<WikiDocumentDto>.Fail("Wiki 文档不存在");
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(doc.ProjectId, cancellationToken);
        return ApiResponse<WikiDocumentDto>.Ok(Map(doc, project?.Name ?? string.Empty));
    }

    public async Task<ApiResponse<WikiDocumentDto>> GenerateAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null) return ApiResponse<WikiDocumentDto>.Fail("项目不存在");
        if (project.ProjectType != "Local")
            return ApiResponse<WikiDocumentDto>.Fail("远程（SSH）项目暂不支持生成 Wiki，请以本地目录方式登记该项目");
        if (!Directory.Exists(project.DirectoryPath))
            return ApiResponse<WikiDocumentDto>.Fail("项目目录不存在，请检查路径");

        var context = CollectProjectContext(project.DirectoryPath);
        if (string.IsNullOrWhiteSpace(context))
            return ApiResponse<WikiDocumentDto>.Fail("未能读取到项目资料，目录可能为空或全部被忽略规则过滤");

        ILLMProvider? provider;
        try
        {
            provider = await _llmProviderFactory.CreateCompletionProviderAsync(cancellationToken)
                       ?? await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            return ApiResponse<WikiDocumentDto>.Fail(ex.Message.Split('\n')[0]);
        }
        if (provider == null)
            return ApiResponse<WikiDocumentDto>.Fail("未找到可用的模型，请先在设置中配置大模型");

        string content;
        try
        {
            content = await provider.CompleteAsync(BuildUserPrompt(project, context), new CompletionOptions
            {
                ModelId = string.Empty,
                SystemPrompt = WikiSystemPrompt,
                MaxTokens = 4096,
            }, cancellationToken);
        }
        catch (Exception ex)
        {
            return ApiResponse<WikiDocumentDto>.Fail($"生成失败：{ex.Message.Split('\n')[0]}");
        }

        if (string.IsNullOrWhiteSpace(content))
            return ApiResponse<WikiDocumentDto>.Fail("模型未返回内容，请重试");

        var doc = new WikiDocument
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            Title = ExtractTitle(content, project.Name),
            Content = content.Trim(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await _unitOfWork.WikiDocuments.AddAsync(doc, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WikiDocumentDto>.Ok(Map(doc, project.Name));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var doc = await _unitOfWork.WikiDocuments.GetByIdAsync(id, cancellationToken);
        if (doc == null) return ApiResponse.Fail("Wiki 文档不存在");
        await _unitOfWork.WikiDocuments.DeleteAsync(doc, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    /// <summary>取正文首个一级标题作为文档标题，没有则用项目名兜底</summary>
    private static string ExtractTitle(string content, string projectName)
    {
        var match = Regex.Match(content, @"^#\s+(.+)$", RegexOptions.Multiline);
        var title = match.Success ? match.Groups[1].Value.Trim().TrimEnd('#', ' ') : string.Empty;
        return string.IsNullOrWhiteSpace(title) ? $"{projectName} Wiki" : title;
    }

    private static string BuildUserPrompt(ManagedProject project, string context)
    {
        var description = string.IsNullOrWhiteSpace(project.Description) ? "（未填写）" : project.Description;
        return $"""
            项目名称：{project.Name}
            项目描述：{description}
            项目目录：{project.DirectoryPath}

            【项目资料】
            {context}

            请基于以上项目资料，为该项目生成一份 Wiki 文档（Markdown 格式）。要求：
            1. 只依据提供的资料撰写，不得编造资料中不存在的信息；资料缺失的部分简要说明即可；
            2. 使用二级标题分节，建议包含：项目概述、技术栈、目录结构、核心模块、快速开始（资料支持时）、配置说明（资料支持时）；
            3. 语言简洁专业，避免空话；
            4. 直接输出 Markdown 正文，不要用代码块包裹整篇文档。
            """;
    }

    /// <summary>
    /// 采集项目资料：目录树、文件类型分布、说明 / 清单文件内容、源码采样。
    /// 忽略规则与 Work 工具一致（内置目录 + .gitignore / .hetuignore）。
    /// </summary>
    private static string CollectProjectContext(string root)
    {
        var files = EnumerateFiles(root);
        if (files.Count == 0) return string.Empty;

        var sb = new StringBuilder();
        sb.AppendLine("## 目录结构（深度不超过 3 层，已忽略构建 / 依赖目录）");
        sb.AppendLine("```");
        sb.AppendLine(BuildTree(root));
        sb.AppendLine("```");
        sb.AppendLine();

        var stats = files
            .GroupBy(f => Path.GetExtension(f).ToLowerInvariant())
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key, StringComparer.Ordinal)
            .Take(12)
            .Select(g => $"{g.Key}({g.Count()})");
        sb.AppendLine("## 文件类型分布");
        sb.AppendLine(string.Join("、", stats));
        sb.AppendLine();

        AppendKeyFiles(sb, root, files);
        AppendSourceSamples(sb, root, files);
        return sb.ToString().Trim();
    }

    /// <summary>说明 / 清单文件：浅层路径优先，按预算截断</summary>
    private static void AppendKeyFiles(StringBuilder sb, string root, List<string> files)
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
            var text = ReadTextHead(file, budget);
            if (text == null) continue;
            budget -= text.Length;
            sb.AppendLine($"### {Path.GetRelativePath(root, file)}");
            sb.AppendLine("````");
            sb.AppendLine(text);
            sb.AppendLine("````");
            sb.AppendLine();
        }
    }

    /// <summary>源码采样：候选均匀取样，按预算截断</summary>
    private static void AppendSourceSamples(StringBuilder sb, string root, List<string> files)
    {
        var candidates = files
            .Where(f => SourceExtensions.Contains(Path.GetExtension(f)))
            .Where(f => !Path.GetFileName(f).EndsWith(".min.js", StringComparison.OrdinalIgnoreCase)
                        && !Path.GetFileName(f).EndsWith(".min.css", StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => Path.GetRelativePath(root, f), StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (candidates.Count == 0) return;

        var picked = new List<string>();
        if (candidates.Count <= MaxSourceFiles)
        {
            picked.AddRange(candidates);
        }
        else
        {
            for (var i = 0; i < MaxSourceFiles; i++)
                picked.Add(candidates[(int)((long)i * candidates.Count / MaxSourceFiles)]);
        }

        sb.AppendLine($"## 源码采样（{picked.Count} / {candidates.Count} 个代码文件，内容有截断）");
        var budget = SourceBudget;
        foreach (var file in picked)
        {
            if (budget <= 0)
            {
                sb.AppendLine("…（其余源码已省略）");
                break;
            }
            var text = ReadTextHead(file, Math.Min(SourceFileLimit, budget));
            if (text == null) continue;
            budget -= text.Length;
            sb.AppendLine($"### {Path.GetRelativePath(root, file)}");
            sb.AppendLine("````");
            sb.AppendLine(text);
            sb.AppendLine("````");
            sb.AppendLine();
        }
    }

    private static bool IsKeyFile(string file)
    {
        var name = Path.GetFileName(file);
        return KeyFileNames.Contains(name)
               || KeyFileNames.Contains(Path.GetFileNameWithoutExtension(file))
               || KeyFileExtensions.Contains(Path.GetExtension(file));
    }

    /// <summary>读取文件头部文本；不可读 / 非文本 / 空文件返回 null</summary>
    private static string? ReadTextHead(string file, int maxChars)
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

    /// <summary>按忽略规则全量枚举项目文件（有数量上限，避免超大目录长期占用）</summary>
    private static List<string> EnumerateFiles(string root)
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

    /// <summary>构建缩进目录树：目录优先，同层按名称排序</summary>
    private static string BuildTree(string root)
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

    private static WikiDocumentDto Map(WikiDocument doc, string projectName) => new()
    {
        Id = doc.Id,
        ProjectId = doc.ProjectId,
        ProjectName = projectName,
        Title = doc.Title,
        Content = doc.Content,
        CreatedAt = doc.CreatedAt,
        UpdatedAt = doc.UpdatedAt,
    };
}
