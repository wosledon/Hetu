using System.IO.Compression;
using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Work;
using Hetu.Core.Utilities;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>
/// 项目 Wiki 生成服务：采集项目目录资料（本地 / SSH 远端）→ LLM 规划分页 → 并行生成主题页 → 生成总览。
/// 代码上下文优先走项目已有的代码语义索引（按每页要点检索相关代码块），无索引时回退为源码采样。
/// 生成入队后由后台任务执行，进度写入 <see cref="WikiGenerationJob"/>。
/// </summary>
public class WikiService : IWikiService
{
    private const int MaxModulePages = 6;
    private const int MaxPageConcurrency = 4;
    private const int SemanticHitsPerPage = 10;

    private const string SystemPromptDocEngineer = "你是资深项目文档工程师，擅长阅读代码仓库并撰写准确、清晰的中文技术文档。";
    private const string SystemPromptArchitect = "你是资深软件架构师，擅长为代码仓库规划文档结构。";

    private readonly IUnitOfWork _unitOfWork;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly IWorkCodeIndexService _codeIndexService;
    private readonly IWorkCommandRunnerFactory _runnerFactory;
    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly ILogger<WikiService> _logger;

    public WikiService(
        IUnitOfWork unitOfWork,
        ILLMProviderFactory llmProviderFactory,
        IWorkCodeIndexService codeIndexService,
        IWorkCommandRunnerFactory runnerFactory,
        IBackgroundTaskQueue taskQueue,
        ILogger<WikiService> logger)
    {
        _unitOfWork = unitOfWork;
        _llmProviderFactory = llmProviderFactory;
        _codeIndexService = codeIndexService;
        _runnerFactory = runnerFactory;
        _taskQueue = taskQueue;
        _logger = logger;
    }

    #region 查询

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

    public async Task<ApiResponse<List<WikiSetDto>>> GetSetsAsync(Guid? projectId, CancellationToken cancellationToken = default)
    {
        var docs = await _unitOfWork.WikiDocuments.GetAllAsync(cancellationToken);
        var projects = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        var byId = projects.ToDictionary(p => p.Id, p => p);
        var query = docs.AsEnumerable();
        if (projectId is Guid pid) query = query.Where(d => d.ProjectId == pid);

        var sets = query
            .GroupBy(d => d.SetId)
            .Select(g => new WikiSetDto
            {
                SetId = g.Key,
                ProjectId = g.Key == Guid.Empty ? Guid.Empty : g.First().ProjectId,
                ProjectName = g.First().ProjectId is { } projId && byId.ContainsKey(projId) ? byId[projId].Name : string.Empty,
                Title = g.OrderBy(d => d.SortOrder).First().Title,
                PageCount = g.Count(),
                CreatedAt = g.Min(d => d.CreatedAt),
                Pages = g.OrderBy(d => d.SortOrder)
                    .Select(d => new WikiSetPageDto { Id = d.Id, Title = d.Title, SortOrder = d.SortOrder })
                    .ToList(),
            })
            .OrderByDescending(s => s.CreatedAt)
            .ToList();

        // 过期判定按套件生成时间与项目文件变更比对（本地遍历 / 远端 find -newermt）
        foreach (var set in sets)
        {
            if (!byId.TryGetValue(set.ProjectId, out var project)) continue;
            var (staleCount, isStale) = await WikiContextCollector.ComputeStaleAsync(
                project, _runnerFactory, _unitOfWork, set.CreatedAt, cancellationToken);
            set.StaleFileCount = staleCount;
            set.IsStale = isStale;
        }

        return ApiResponse<List<WikiSetDto>>.Ok(sets);
    }

    public async Task<ApiResponse<WikiDocumentDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var doc = await _unitOfWork.WikiDocuments.GetByIdAsync(id, cancellationToken);
        if (doc == null) return ApiResponse<WikiDocumentDto>.Fail("Wiki 文档不存在");
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(doc.ProjectId, cancellationToken);
        return ApiResponse<WikiDocumentDto>.Ok(Map(doc, project?.Name ?? string.Empty));
    }

    public async Task<ApiResponse<List<WikiGenerationJobDto>>> GetJobsAsync(Guid? projectId, CancellationToken cancellationToken = default)
    {
        var jobs = await _unitOfWork.WikiGenerationJobs.GetAllAsync(cancellationToken);
        var projects = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        var projectNames = projects.ToDictionary(p => p.Id, p => p.Name);
        var query = jobs.AsEnumerable();
        if (projectId is Guid pid) query = query.Where(j => j.ProjectId == pid);
        return ApiResponse<List<WikiGenerationJobDto>>.Ok(query
            .OrderByDescending(j => j.CreatedAt)
            .Take(20)
            .Select(j => MapJob(j, projectNames.GetValueOrDefault(j.ProjectId)))
            .ToList());
    }

    public async Task<ApiResponse<WikiGenerationJobDto>> GetJobAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var job = await _unitOfWork.WikiGenerationJobs.GetByIdAsync(id, cancellationToken);
        if (job == null) return ApiResponse<WikiGenerationJobDto>.Fail("任务不存在");
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(job.ProjectId, cancellationToken);
        return ApiResponse<WikiGenerationJobDto>.Ok(MapJob(job, project?.Name ?? string.Empty));
    }

    #endregion

    #region 生成

    public async Task<ApiResponse<WikiGenerationJobDto>> EnqueueGenerateAsync(Guid projectId, Guid? modelId, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null) return ApiResponse<WikiGenerationJobDto>.Fail("项目不存在");

        // 同一项目已有进行中任务时直接返回，避免重复消耗 Token
        var active = (await _unitOfWork.WikiGenerationJobs.GetAllAsync(cancellationToken))
            .Where(j => j.ProjectId == projectId && j.Status is 0 or 1)
            .OrderByDescending(j => j.CreatedAt)
            .FirstOrDefault();
        if (active != null)
        {
            var activeProjectName = (await _unitOfWork.ManagedProjects.GetByIdAsync(active.ProjectId, cancellationToken))?.Name ?? string.Empty;
            return ApiResponse<WikiGenerationJobDto>.Ok(MapJob(active, activeProjectName));
        }

        // 入队前先做可读性校验，失败直接反馈，不占用后台任务
        var material = await WikiContextCollector.CollectAsync(project, _runnerFactory, _unitOfWork, cancellationToken);
        if (!material.HasContext)
            return ApiResponse<WikiGenerationJobDto>.Fail(material.Failure ?? "未能读取到项目资料");

        var modelName = await ResolveModelNameAsync(modelId, cancellationToken);
        var job = new WikiGenerationJob
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            Status = 0,
            Stage = "排队中",
            Progress = 0,
            TotalPages = 0,
            DonePages = 0,
            ModelId = modelName,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await _unitOfWork.WikiGenerationJobs.AddAsync(job, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        await _taskQueue.QueueAsync(new BackgroundWorkItem(BackgroundTaskType.WikiGenerate, job.Id, modelId?.ToString()), cancellationToken);
        return ApiResponse<WikiGenerationJobDto>.Ok(MapJob(job, project.Name));
    }

    /// <summary>后台处理器调用：规划分页 → 并行生成主题页 → 生成总览，进度实时写入任务记录</summary>
    public async Task RunGenerationAsync(Guid jobId, Guid? modelId, CancellationToken cancellationToken = default)
    {
        var job = await _unitOfWork.WikiGenerationJobs.GetByIdAsync(jobId, cancellationToken);
        if (job == null) return;
        if (job.Status is not (0 or 1)) return; // 已完成 / 已失败的任务不重复执行

        try
        {
            await RunGenerationCoreAsync(job, modelId, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw; // 服务停止时交回处理器重新排队
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki 生成任务 {JobId} 失败", jobId);
            job.Status = 3;
            job.ErrorMessage = ex.Message.Split('\n')[0];
            job.CompletedAt = DateTimeOffset.UtcNow;
            job.UpdatedAt = job.CompletedAt.Value;
            await _unitOfWork.WikiGenerationJobs.UpdateAsync(job, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task RunGenerationCoreAsync(WikiGenerationJob job, Guid? modelId, CancellationToken cancellationToken)
    {
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(job.ProjectId, cancellationToken);
        if (project == null) throw new InvalidOperationException("项目不存在");

        job.Status = 1;
        job.Stage = "启动";
        job.Progress = 1;
        job.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WikiGenerationJobs.UpdateAsync(job, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var provider = await ResolveProviderAsync(modelId, cancellationToken);
        if (provider == null) throw new InvalidOperationException("未找到可用的模型，请先在设置中配置大模型");

        job.Stage = "采集项目资料";
        job.Progress = 5;
        await SaveJobAsync(job, cancellationToken);

        var material = await WikiContextCollector.CollectAsync(project, _runnerFactory, _unitOfWork, cancellationToken);
        if (!material.HasContext)
            throw new InvalidOperationException(material.Failure ?? "未能读取到项目资料");

        // 代码上下文：有语义索引用检索结果，否则用源码采样兜底
        var workProjectId = project.ProjectType == "Ssh"
            ? material.WorkProjectId
            : await WikiContextCollector.FindLocalWorkProjectIdAsync(project, _unitOfWork, cancellationToken);
        var useSemantic = false;
        if (workProjectId is Guid wpId)
        {
            var status = await _codeIndexService.GetStatusAsync(wpId, cancellationToken);
            useSemantic = status is { Success: true, Data.IsReady: true };
        }

        job.Stage = "规划分页";
        job.Progress = 10;
        await SaveJobAsync(job, cancellationToken);

        var plans = await PlanModulePagesAsync(provider, project, material, cancellationToken);
        job.TotalPages = plans.Count + 1;
        await SaveJobAsync(job, cancellationToken);

        var setId = Guid.NewGuid();
        var donePages = 0;
        using var throttle = new SemaphoreSlim(MaxPageConcurrency);
        var pageTasks = plans.Select(async plan =>
        {
            await throttle.WaitAsync(cancellationToken);
            try
            {
                var page = await BuildPageAsync(provider, project, material, plan, plans.Select(p => p.Title), workProjectId, useSemantic, cancellationToken);
                if (string.IsNullOrWhiteSpace(page.Content)) return null;
                return new WikiDocument
                {
                    Id = Guid.NewGuid(),
                    ProjectId = project.Id,
                    SetId = setId,
                    SortOrder = plan.Index + 1,
                    Title = page.Title,
                    Brief = page.Brief,
                    Content = page.Content,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // 单页失败不阻塞整套
                _logger.LogWarning(ex, "Wiki 页面「{Title}」生成失败", plan.Title);
                return null;
            }
            finally
            {
                throttle.Release();
                var done = Interlocked.Increment(ref donePages);
                job.DonePages = done;
                job.Progress = 15 + (int)(done * 70.0 / Math.Max(1, plans.Count));
                job.Stage = $"生成页面 {done}/{plans.Count}";
                job.UpdatedAt = DateTimeOffset.UtcNow;
                try { await _unitOfWork.WikiGenerationJobs.UpdateAsync(job, cancellationToken); await _unitOfWork.SaveChangesAsync(cancellationToken); }
                catch (Exception ex) when (ex is not OperationCanceledException) { /* 进度写库失败不影响生成 */ }
            }
        }).ToList();

        var modulePages = (await Task.WhenAll(pageTasks)).Where(p => p != null).ToList()!;
        if (modulePages.Count == 0)
            throw new InvalidOperationException("所有页面均生成失败，请检查模型配置后重试");

        job.Stage = "生成总览";
        job.Progress = 90;
        await SaveJobAsync(job, cancellationToken);

        var overview = await GenerateOverviewAsync(provider, project, material, modulePages, workProjectId, useSemantic, cancellationToken);
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

        job.Status = 2;
        job.Stage = "已完成";
        job.Progress = 100;
        job.DonePages = modulePages.Count + 1;
        job.SetId = setId;
        job.CompletedAt = DateTimeOffset.UtcNow;
        job.UpdatedAt = job.CompletedAt.Value;
        await _unitOfWork.WikiGenerationJobs.UpdateAsync(job, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }

    public async Task<ApiResponse<WikiDocumentDto>> RegeneratePageAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var doc = await _unitOfWork.WikiDocuments.GetByIdAsync(id, cancellationToken);
        if (doc == null) return ApiResponse<WikiDocumentDto>.Fail("Wiki 文档不存在");

        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(doc.ProjectId, cancellationToken);
        if (project == null) return ApiResponse<WikiDocumentDto>.Fail("项目不存在");

        var material = await WikiContextCollector.CollectAsync(project, _runnerFactory, _unitOfWork, cancellationToken);
        if (!material.HasContext)
            return ApiResponse<WikiDocumentDto>.Fail(material.Failure ?? "未能读取到项目资料");

        var provider = await ResolveProviderAsync(null, cancellationToken);
        if (provider == null) return ApiResponse<WikiDocumentDto>.Fail("未找到可用的模型，请先在设置中配置大模型");

        var workProjectId = project.ProjectType == "Ssh"
            ? material.WorkProjectId
            : await WikiContextCollector.FindLocalWorkProjectIdAsync(project, _unitOfWork, cancellationToken);
        var useSemantic = false;
        if (workProjectId is Guid wpId)
        {
            var status = await _codeIndexService.GetStatusAsync(wpId, cancellationToken);
            useSemantic = status is { Success: true, Data.IsReady: true };
        }

        var siblings = (await _unitOfWork.WikiDocuments.GetAllAsync(cancellationToken))
            .Where(d => d.SetId == doc.SetId && d.Id != doc.Id)
            .OrderBy(d => d.SortOrder)
            .Select(d => d.Title)
            .ToList();

        // 总览页按总览逻辑重生成，主题页按原要点重生成
        WikiDocument regenerated;
        try
        {
            regenerated = doc.SortOrder == 0
                ? await GenerateOverviewAsync(provider, project, material,
                    (await _unitOfWork.WikiDocuments.GetAllAsync(cancellationToken))
                        .Where(d => d.SetId == doc.SetId && d.SortOrder > 0)
                        .OrderBy(d => d.SortOrder)
                        .Select(d => new WikiDocument { Title = d.Title })
                        .ToList(),
                    workProjectId, useSemantic, cancellationToken)
                : await BuildPageAsync(provider, project, material,
                    new WikiPagePlan { Index = doc.SortOrder, Title = doc.Title, Brief = doc.Brief ?? string.Empty },
                    siblings, workProjectId, useSemantic, cancellationToken);
        }
        catch (Exception ex)
        {
            return ApiResponse<WikiDocumentDto>.Fail($"重生成失败：{ex.Message.Split('\n')[0]}");
        }

        doc.Content = regenerated.Content;
        doc.Brief = regenerated.Brief ?? doc.Brief;
        doc.Title = doc.SortOrder == 0 ? project.Name : doc.Title;
        doc.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WikiDocuments.UpdateAsync(doc, cancellationToken);
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

    public async Task<ApiResponse<byte[]>> ExportSetAsync(Guid setId, CancellationToken cancellationToken = default)
    {
        var docs = (await _unitOfWork.WikiDocuments.GetAllAsync(cancellationToken))
            .Where(d => d.SetId == setId)
            .OrderBy(d => d.SortOrder)
            .ToList();
        if (docs.Count == 0) return ApiResponse<byte[]>.Fail("Wiki 套件不存在");

        var projectName = (await _unitOfWork.ManagedProjects.GetByIdAsync(docs[0].ProjectId, cancellationToken))?.Name ?? "wiki";
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true, Encoding.UTF8))
        {
            var index = new StringBuilder();
            index.AppendLine($"# {projectName} Wiki").AppendLine();
            for (var i = 0; i < docs.Count; i++)
            {
                var doc = docs[i];
                var fileName = $"{i:00}-{SafeFileName(doc.Title)}.md";
                index.AppendLine($"- [{doc.Title}](./{fileName})");
                var entry = zip.CreateEntry(fileName, CompressionLevel.Optimal);
                await using var entryStream = entry.Open();
                var content = $"# {doc.Title}\n\n{doc.Content}";
                await entryStream.WriteAsync(Encoding.UTF8.GetBytes(content), cancellationToken);
            }
            var readme = zip.CreateEntry("README.md", CompressionLevel.Optimal);
            await using var readmeStream = readme.Open();
            await readmeStream.WriteAsync(Encoding.UTF8.GetBytes(index.ToString()), cancellationToken);
        }
        return ApiResponse<byte[]>.Ok(ms.ToArray());
    }

    #endregion

    #region LLM 调用

    private async Task<List<WikiPagePlan>> PlanModulePagesAsync(
        ILLMProvider provider, ManagedProject project, WikiSourceMaterial material, CancellationToken cancellationToken)
    {
        const string JsonSpec = "{\"pages\":[{\"title\":\"页面标题（12字以内）\",\"brief\":\"该页应涵盖的内容要点（60字以内）\"}]}";
        var prompt = $"""
            项目名称：{project.Name}
            项目描述：{(string.IsNullOrWhiteSpace(project.Description) ? "（未填写）" : project.Description)}

            【项目资料】
            {material.BaseContext}

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
                SystemPrompt = SystemPromptArchitect,
                MaxTokens = 2048,
            }, cancellationToken);
            var outline = LlmJsonExtractor.Deserialize<WikiOutline>(response);
            if (outline != null)
                plans = outline.Pages
                    .Where(p => !string.IsNullOrWhiteSpace(p.Title))
                    .Select((p, i) => new WikiPagePlan { Index = i, Title = p.Title.Trim(), Brief = (p.Brief ?? string.Empty).Trim() })
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
                new WikiPagePlan { Index = 0, Title = "项目概述与技术栈", Brief = "项目定位、核心特性、技术栈组成" },
                new WikiPagePlan { Index = 1, Title = "目录结构", Brief = "顶层目录职责与关键文件说明" },
                new WikiPagePlan { Index = 2, Title = "核心模块详解", Brief = "主要模块职责、关键类型与调用关系" },
                new WikiPagePlan { Index = 3, Title = "快速开始与配置", Brief = "环境要求、构建运行步骤、配置项" },
            ];
        return plans;
    }

    /// <summary>生成单个主题页：基础资料 +（语义检索的相关代码 或 源码采样）</summary>
    private async Task<WikiDocument> BuildPageAsync(
        ILLMProvider provider,
        ManagedProject project,
        WikiSourceMaterial material,
        WikiPagePlan plan,
        IEnumerable<string> siblingTitles,
        Guid? workProjectId,
        bool useSemantic,
        CancellationToken cancellationToken)
    {
        var codeContext = await BuildCodeContextAsync(workProjectId, useSemantic, material, $"{plan.Title} {plan.Brief}", cancellationToken);
        var siblings = string.Join("、", siblingTitles.Where(t => t != plan.Title));
        var siblingLine = siblings.Length > 0 ? $"\n同套其他页面：{siblings}（可在正文中按名称相互引用）" : string.Empty;

        var prompt = $"""
            项目名称：{project.Name}
            项目描述：{(string.IsNullOrWhiteSpace(project.Description) ? "（未填写）" : project.Description)}
            项目目录：{project.DirectoryPath}

            【项目资料】
            {material.BaseContext}
            {codeContext}
            【本页任务】
            页面标题：{plan.Title}
            内容要点：{plan.Brief}{siblingLine}

            请撰写本页内容（Markdown，中文）。要求：
            1. 只依据提供的资料撰写，不得编造资料中不存在的信息；资料缺失的部分简要说明即可；
            2. 用二级标题（##）组织小节，不要输出一级标题，不要输出页面导航章节；
            3. 内容涉及结构、流程或模块关系时，使用 ```mermaid 代码块绘制相应图表（架构图 / 数据流图 / 时序图 / 类图等，按内容选择）；
            4. 代码、类型、路径用行内代码标注；
            5. 语言简洁专业，避免空话；
            6. 直接输出 Markdown 正文，不要用代码块包裹整篇内容。
            """;

        var content = await provider.CompleteAsync(prompt, new CompletionOptions
        {
            ModelId = string.Empty,
            SystemPrompt = SystemPromptDocEngineer,
            MaxTokens = 4096,
        }, cancellationToken);

        return new WikiDocument { Title = plan.Title, Brief = plan.Brief, Content = content.Trim() };
    }

    /// <summary>生成总览页：项目介绍 + 技术栈 + 架构图 + 真实页面导航</summary>
    private async Task<WikiDocument> GenerateOverviewAsync(
        ILLMProvider provider,
        ManagedProject project,
        WikiSourceMaterial material,
        List<WikiDocument> modulePages,
        Guid? workProjectId,
        bool useSemantic,
        CancellationToken cancellationToken)
    {
        var nav = string.Join("\n", modulePages.Select(p => $"- {p.Title}"));
        var codeContext = await BuildCodeContextAsync(workProjectId, useSemantic, material, "总体架构 核心组件 数据流", cancellationToken);

        var prompt = $"""
            项目名称：{project.Name}
            项目描述：{(string.IsNullOrWhiteSpace(project.Description) ? "（未填写）" : project.Description)}
            项目目录：{project.DirectoryPath}

            【项目资料】
            {material.BaseContext}
            {codeContext}
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
                SystemPrompt = SystemPromptDocEngineer,
                MaxTokens = 4096,
            }, cancellationToken);
            if (!string.IsNullOrWhiteSpace(content))
                return new WikiDocument { Title = project.Name, Content = content.Trim() };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 回退到纯文本总览
        }

        var description = string.IsNullOrWhiteSpace(project.Description) ? "" : $"\n\n{project.Description}";
        return new WikiDocument
        {
            Title = project.Name,
            Content = $"""
                ## 项目简介

                {project.Name}{description}

                ## 文档导航

                {nav}
                """,
        };
    }

    /// <summary>
    /// 页面级代码上下文：有语义索引时按本页要点检索相关代码块；否则用源码采样兜底。
    /// </summary>
    private async Task<string> BuildCodeContextAsync(
        Guid? workProjectId, bool useSemantic, WikiSourceMaterial material, string query, CancellationToken cancellationToken)
    {
        if (useSemantic && workProjectId is Guid wpId)
        {
            try
            {
                var hits = await _codeIndexService.SearchAsync(wpId, query, SemanticHitsPerPage, cancellationToken);
                if (hits is { Success: true, Data.Count: > 0 })
                {
                    var sb = new StringBuilder();
                    sb.AppendLine("## 与本页相关的代码（语义检索结果，按相关度排序）");
                    foreach (var hit in hits.Data)
                        sb.AppendLine($"### {hit.Path}:{hit.StartLine}\n````\n{hit.Snippet}\n````");
                    return sb.ToString().Trim() + "\n";
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // 检索失败回退到源码采样
            }
        }

        return string.IsNullOrWhiteSpace(material.FallbackSources)
            ? string.Empty
            : material.FallbackSources + "\n";
    }

    private async Task<ILLMProvider?> ResolveProviderAsync(Guid? modelId, CancellationToken cancellationToken)
    {
        try
        {
            if (modelId is Guid id)
                return await _llmProviderFactory.CreateProviderAsync(id, cancellationToken);
            return await _llmProviderFactory.CreateCompletionProviderAsync(cancellationToken)
                   ?? await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
    }

    private async Task<string?> ResolveModelNameAsync(Guid? modelId, CancellationToken cancellationToken)
    {
        if (modelId is not Guid id) return null;
        var model = await _unitOfWork.AiModels.GetByIdAsync(id, cancellationToken);
        return model?.DisplayName ?? model?.ModelId;
    }

    private async Task SaveJobAsync(WikiGenerationJob job, CancellationToken cancellationToken)
    {
        job.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WikiGenerationJobs.UpdateAsync(job, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }

    #endregion

    #region 映射

    private static WikiDocumentDto Map(WikiDocument doc, string projectName) => new()
    {
        Id = doc.Id,
        ProjectId = doc.ProjectId,
        ProjectName = projectName,
        SetId = doc.SetId,
        SortOrder = doc.SortOrder,
        Title = doc.Title,
        Brief = doc.Brief,
        Content = doc.Content,
        CreatedAt = doc.CreatedAt,
        UpdatedAt = doc.UpdatedAt,
    };

    private static WikiGenerationJobDto MapJob(WikiGenerationJob job, string projectName) => new()
    {
        Id = job.Id,
        ProjectId = job.ProjectId,
        ProjectName = projectName,
        Status = job.Status,
        Stage = job.Stage,
        Progress = job.Progress,
        TotalPages = job.TotalPages,
        DonePages = job.DonePages,
        ErrorMessage = job.ErrorMessage,
        ModelId = job.ModelId,
        SetId = job.SetId,
        CreatedAt = job.CreatedAt,
        CompletedAt = job.CompletedAt,
    };

    private static string SafeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(name.Select(c => invalid.Contains(c) ? '_' : c).ToArray()).Trim();
        return cleaned.Length == 0 ? "untitled" : cleaned[..Math.Min(60, cleaned.Length)];
    }

    /// <summary>大纲中的单个主题页</summary>
    private sealed class WikiPagePlan
    {
        public int Index { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Brief { get; set; } = string.Empty;
    }

    /// <summary>大纲规划结果（LLM JSON 输出）</summary>
    private sealed class WikiOutline
    {
        public List<WikiOutlinePage> Pages { get; set; } = [];
    }

    private sealed class WikiOutlinePage
    {
        public string Title { get; set; } = string.Empty;
        public string? Brief { get; set; }
    }

    #endregion
}
