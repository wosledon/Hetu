using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Utilities;
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
    /// <summary>单套 Wiki 的主题页数量上限（不含总览）</summary>
    private const int MaxModulePages = 6;
    /// <summary>主题页并行生成的最大并发</summary>
    private const int MaxPageConcurrency = 4;

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
        // 按套件聚合：新套件在前，套件内按排序（总览在前）
        return ApiResponse<List<WikiDocumentDto>>.Ok(query
            .GroupBy(d => d.SetId)
            .OrderByDescending(g => g.Max(d => d.CreatedAt))
            .SelectMany(g => g.OrderBy(d => d.SortOrder))
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

        // 第一阶段：规划主题页（总览页单独在最后生成）
        var plans = await PlanModulePagesAsync(provider, project, context, cancellationToken);
        if (plans.Count == 0)
            return ApiResponse<WikiDocumentDto>.Fail("未能规划出 Wiki 页面，请重试");

        // 第二阶段：并行生成主题页；个别页面失败不阻塞整套
        var setId = Guid.NewGuid();
        using var throttle = new SemaphoreSlim(MaxPageConcurrency);
        var pageTasks = plans.Select(async (plan, index) =>
        {
            await throttle.WaitAsync(cancellationToken);
            try
            {
                var content = await GeneratePageAsync(
                    provider, project, context, plan.Title, plan.Brief,
                    plans.Select(p => p.Title), cancellationToken);
                if (string.IsNullOrWhiteSpace(content)) return null;
                return new WikiDocument
                {
                    Id = Guid.NewGuid(),
                    ProjectId = project.Id,
                    SetId = setId,
                    SortOrder = index + 1,
                    Title = plan.Title,
                    Content = content,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return null;
            }
            finally
            {
                throttle.Release();
            }
        }).ToList();
        var modulePages = (await Task.WhenAll(pageTasks)).Where(p => p != null).ToList()!;
        if (modulePages.Count == 0)
            return ApiResponse<WikiDocumentDto>.Fail("所有页面均生成失败，请检查模型配置后重试");

        // 第三阶段：总览页（携带真实页面清单做导航）
        var overview = await GenerateOverviewAsync(provider, project, context, modulePages, cancellationToken);
        overview.Id = Guid.NewGuid();
        overview.ProjectId = project.Id;
        overview.SetId = setId;
        overview.SortOrder = 0;
        overview.Title = project.Name;
        overview.CreatedAt = DateTimeOffset.UtcNow;
        overview.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.WikiDocuments.AddAsync(overview, cancellationToken);
        foreach (var page in modulePages)
            await _unitOfWork.WikiDocuments.AddAsync(page, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WikiDocumentDto>.Ok(Map(overview, project.Name));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var doc = await _unitOfWork.WikiDocuments.GetByIdAsync(id, cancellationToken);
        if (doc == null) return ApiResponse.Fail("Wiki 文档不存在");
        await _unitOfWork.WikiDocuments.DeleteAsync(doc, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    /// <summary>大纲规划：让模型按项目真实结构划分主题页；解析失败时回退默认分页</summary>
    private async Task<List<WikiPagePlan>> PlanModulePagesAsync(
        ILLMProvider provider, ManagedProject project, string context, CancellationToken cancellationToken)
    {
        // JSON 模板含大量花括号，预计算避免与插值语法冲突
        const string JsonSpec = "{\"pages\":[{\"title\":\"页面标题（12字以内）\",\"brief\":\"该页应涵盖的内容要点（60字以内）\"}]}";
        var prompt = $"""
            项目名称：{project.Name}
            项目描述：{(string.IsNullOrWhiteSpace(project.Description) ? "（未填写）" : project.Description)}

            【项目资料】
            {context}

            请为该项目规划一套 Wiki 文档的主题分页（DeepWiki 风格，不包含总览页，总览将单独生成）。
            按项目的真实结构划分 2-{MaxModulePages} 个主题页，每个主题聚焦一个模块 / 领域 / 关注点（如架构设计、数据流、核心模块、API 参考、快速开始与配置等，按项目实际取舍）。
            只输出 JSON，不要输出其他内容，格式如下：
            {JsonSpec}
            """;
        List<WikiPagePlan> plans = [];
        try
        {
            var response = await provider.CompleteAsync(prompt, new CompletionOptions
            {
                ModelId = string.Empty,
                SystemPrompt = "你是资深软件架构师，擅长为代码仓库规划文档结构。",
                MaxTokens = 2048,
            }, cancellationToken);
            var outline = LlmJsonExtractor.Deserialize<WikiOutline>(response);
            if (outline != null)
                plans = outline.Pages
                    .Where(p => !string.IsNullOrWhiteSpace(p.Title))
                    .Select(p => new WikiPagePlan { Title = p.Title.Trim(), Brief = (p.Brief ?? string.Empty).Trim() })
                    .Take(MaxModulePages)
                    .ToList();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 规划失败走默认分页，不阻塞整体生成
        }

        if (plans.Count == 0)
            plans =
            [
                new() { Title = "项目概述与技术栈", Brief = "项目定位、核心特性、技术栈组成" },
                new() { Title = "目录结构", Brief = "顶层目录职责与关键文件说明" },
                new() { Title = "核心模块详解", Brief = "主要模块职责、关键类型与调用关系" },
                new() { Title = "快速开始与配置", Brief = "环境要求、构建运行步骤、配置项" },
            ];
        return plans;
    }

    /// <summary>生成单个主题页</summary>
    private async Task<string> GeneratePageAsync(
        ILLMProvider provider,
        ManagedProject project,
        string context,
        string pageTitle,
        string pageBrief,
        IEnumerable<string> siblingTitles,
        CancellationToken cancellationToken)
    {
        var siblings = string.Join("、", siblingTitles.Where(t => t != pageTitle));
        var prompt = $"""
            项目名称：{project.Name}
            项目描述：{(string.IsNullOrWhiteSpace(project.Description) ? "（未填写）" : project.Description)}
            项目目录：{project.DirectoryPath}

            【项目资料】
            {context}

            【本页任务】
            页面标题：{pageTitle}
            内容要点：{pageBrief}
            {($"同套其他页面：{siblings}（可在正文中按名称相互引用）")}

            请撰写本页内容（Markdown，中文）。要求：
            1. 只依据提供的资料撰写，不得编造资料中不存在的信息；资料缺失的部分简要说明即可；
            2. 用二级标题（##）组织小节，不要输出一级标题，不要输出页面导航章节；
            3. 在适合的位置必须使用 ```mermaid 代码块绘制图表（架构图 / 数据流图 / 时序图 / 类图等，按内容选择），至少一处；
            4. 代码、类型、路径用行内代码标注；
            5. 语言简洁专业，避免空话；
            6. 直接输出 Markdown 正文，不要用代码块包裹整篇内容。
            """;
        var content = await provider.CompleteAsync(prompt, new CompletionOptions
        {
            ModelId = string.Empty,
            SystemPrompt = WikiSystemPrompt,
            MaxTokens = 4096,
        }, cancellationToken);
        return content.Trim();
    }

    /// <summary>生成总览页：项目介绍 + 技术栈 + 架构图 + 真实页面导航；失败时回退纯文本总览</summary>
    private async Task<WikiDocument> GenerateOverviewAsync(
        ILLMProvider provider, ManagedProject project, string context, List<WikiDocument> modulePages, CancellationToken cancellationToken)
    {
        var nav = string.Join("\n", modulePages.Select(p => $"- {p.Title}"));
        var prompt = $"""
            项目名称：{project.Name}
            项目描述：{(string.IsNullOrWhiteSpace(project.Description) ? "（未填写）" : project.Description)}
            项目目录：{project.DirectoryPath}

            【项目资料】
            {context}

            【本套件包含以下主题页】
            {nav}

            【本页任务】撰写总览页（Markdown，中文）。要求：
            1. 只依据提供的资料撰写，不得编造；
            2. 用二级标题（##）组织小节，依次涵盖：项目简介、核心特性、技术栈、总体架构；
            3. 「总体架构」一节必须包含一个 ```mermaid 代码块绘制的架构图（graph 或 flowchart），清晰表达主要组件及其关系；
            4. 最后一节为「文档导航」，用无序列表原样列出上述主题页标题；
            5. 不要输出一级标题，不要用代码块包裹整篇内容。
            """;
        try
        {
            var content = await provider.CompleteAsync(prompt, new CompletionOptions
            {
                ModelId = string.Empty,
                SystemPrompt = WikiSystemPrompt,
                MaxTokens = 4096,
            }, cancellationToken);
            if (!string.IsNullOrWhiteSpace(content))
                return new WikiDocument { Content = content.Trim() };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 回退到纯文本总览
        }

        var description = string.IsNullOrWhiteSpace(project.Description) ? "" : $"\n\n{project.Description}";
        return new WikiDocument
        {
            Content = $"""
                ## 项目简介

                {project.Name}{description}

                ## 文档导航

                {nav}
                """,
        };
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
        SetId = doc.SetId,
        SortOrder = doc.SortOrder,
        Title = doc.Title,
        Content = doc.Content,
        CreatedAt = doc.CreatedAt,
        UpdatedAt = doc.UpdatedAt,
    };

    /// <summary>大纲中的单个主题页</summary>
    private sealed class WikiPagePlan
    {
        public string Title { get; set; } = string.Empty;
        public string Brief { get; set; } = string.Empty;
    }

    /// <summary>大纲规划结果（LLM JSON 输出）</summary>
    private sealed class WikiOutline
    {
        public List<WikiPagePlan> Pages { get; set; } = [];
    }
}
