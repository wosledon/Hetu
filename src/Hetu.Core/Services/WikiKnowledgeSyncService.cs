using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Projects;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>
/// Wiki → 知识库 / 知识图谱 的同步器。
/// Wiki 页面是生成物，知识库里的 <see cref="KnowledgeItem"/> 只是它的只读投影：
/// 页面更新时覆盖投影，页面删除时连同分块、向量与关系一起清理。
/// </summary>
public class WikiKnowledgeSyncService : IWikiKnowledgeSyncService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IBackgroundTaskCoordinator _taskCoordinator;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly IGraphService _graphService;
    private readonly ILogger<WikiKnowledgeSyncService> _logger;

    public WikiKnowledgeSyncService(
        IUnitOfWork unitOfWork,
        IBackgroundTaskCoordinator taskCoordinator,
        IEmbeddingProviderFactory embeddingProviderFactory,
        ILLMProviderFactory llmProviderFactory,
        IGraphService graphService,
        ILogger<WikiKnowledgeSyncService> logger)
    {
        _unitOfWork = unitOfWork;
        _taskCoordinator = taskCoordinator;
        _embeddingProviderFactory = embeddingProviderFactory;
        _llmProviderFactory = llmProviderFactory;
        _graphService = graphService;
        _logger = logger;
    }

    public async Task<WikiSyncResultDto> SyncAsync(WikiDocument document, CancellationToken cancellationToken = default)
        => await SyncSetAsync([document], cancellationToken);

    public async Task<WikiSyncResultDto> SyncSetAsync(IReadOnlyList<WikiDocument> documents, CancellationToken cancellationToken = default)
    {
        var result = new WikiSyncResultDto { Pages = documents.Count };
        if (documents.Count == 0) return result;

        var projectIds = documents.Select(d => d.ProjectId).Distinct().ToList();
        var projects = await _unitOfWork.ManagedProjects.FindAsync(p => projectIds.Contains(p.Id), cancellationToken);
        var projectNames = projects.ToDictionary(p => p.Id, p => p.Name);

        var documentIds = documents.Select(d => d.Id).ToList();
        var existingItems = await _unitOfWork.KnowledgeItems.FindAsync(
            k => k.Type == KnowledgeItemType.Wiki && k.WikiDocumentId != null && documentIds.Contains(k.WikiDocumentId.Value),
            cancellationToken);
        var itemsByDocument = existingItems
            .Where(k => k.WikiDocumentId.HasValue)
            .GroupBy(k => k.WikiDocumentId!.Value)
            .ToDictionary(g => g.Key, g => g.First());

        var syncedItems = new List<KnowledgeItem>(documents.Count);
        var now = DateTimeOffset.UtcNow;

        foreach (var document in documents)
        {
            var content = BuildContent(document, projectNames.GetValueOrDefault(document.ProjectId) ?? string.Empty);
            if (string.IsNullOrWhiteSpace(content)) continue;

            if (itemsByDocument.TryGetValue(document.Id, out var item))
            {
                if (item.Title != document.Title || item.Content != content)
                {
                    item.Title = document.Title;
                    item.Content = content;
                    item.UpdatedAt = now;
                    await _unitOfWork.KnowledgeItems.UpdateAsync(item, cancellationToken);
                }
            }
            else
            {
                item = new KnowledgeItem
                {
                    Id = Guid.NewGuid(),
                    Type = KnowledgeItemType.Wiki,
                    Title = document.Title,
                    Content = content,
                    WikiDocumentId = document.Id,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                await _unitOfWork.KnowledgeItems.AddAsync(item, cancellationToken);
                result.CreatedItems++;
            }

            syncedItems.Add(item);
        }

        if (syncedItems.Count == 0) return result;

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var embeddingProvider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        result.EmbeddingConfigured = embeddingProvider != null;

        var graphProvider = await _llmProviderFactory.CreateScenarioProviderAsync("Graph", cancellationToken)
                            ?? await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        result.GraphConfigured = graphProvider != null;

        // 索引与抽取都靠后台任务执行：生成过程本身不应被向量/LLM 调用拖住
        if (embeddingProvider != null)
        {
            var indexRequests = syncedItems
                .Select(item => new BackgroundTaskRequest(
                    BackgroundTaskType.GenerateKnowledgeItemEmbedding, item.Id, item.Title))
                .ToList();
            var queued = await _taskCoordinator.EnqueueBatchAsync(indexRequests, cancellationToken);
            result.QueuedIndexTasks = queued.QueuedCount;
        }

        if (graphProvider != null)
        {
            var graphRequests = syncedItems
                .Select(item => new BackgroundTaskRequest(
                    BackgroundTaskType.WikiGraphExtract, item.WikiDocumentId!.Value, item.Title))
                .ToList();
            var queued = await _taskCoordinator.EnqueueBatchAsync(graphRequests, cancellationToken);
            result.QueuedGraphTasks = queued.QueuedCount;
        }

        _logger.LogInformation(
            "[Wiki Sync] pages={Pages} created={Created} indexQueued={Index} graphQueued={Graph}",
            result.Pages, result.CreatedItems, result.QueuedIndexTasks, result.QueuedGraphTasks);

        return result;
    }

    public async Task RemoveAsync(Guid wikiDocumentId, CancellationToken cancellationToken = default)
        => await RemoveSetAsync([wikiDocumentId], cancellationToken);

    public async Task RemoveSetAsync(IReadOnlyCollection<Guid> wikiDocumentIds, CancellationToken cancellationToken = default)
    {
        if (wikiDocumentIds.Count == 0) return;

        var ids = wikiDocumentIds.ToHashSet();
        var items = await _unitOfWork.KnowledgeItems.FindAsync(
            k => k.Type == KnowledgeItemType.Wiki && k.WikiDocumentId != null && ids.Contains(k.WikiDocumentId.Value),
            cancellationToken);

        foreach (var item in items)
        {
            // 分块与向量不是 FK 级联（sqlite-vec 虚表独立），必须显式清理
            await _unitOfWork.KnowledgeItems.DeleteChunksAsync(item.Id, cancellationToken);
            await _unitOfWork.KnowledgeItems.DeleteAsync(item, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        await _graphService.CleanUpByWikiDocumentIdsAsync(ids, cancellationToken);
    }

    private static string BuildContent(WikiDocument document, string projectName)
    {
        if (string.IsNullOrWhiteSpace(document.Content)) return string.Empty;

        var content = document.Content.Trim();
        // Wiki 正文通常已自带标题；只在缺失时补一个，避免索引内容出现重复一级标题
        if (content.StartsWith("# ", StringComparison.Ordinal)) return content;

        var heading = string.IsNullOrWhiteSpace(projectName)
            ? document.Title
            : $"{projectName} · {document.Title}";
        return $"# {heading}\n\n{content}";
    }
}
