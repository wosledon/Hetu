using System.Linq.Expressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace Hetu.Core.Tests;

public class WikiKnowledgeSyncServiceTests
{
    [Fact]
    public async Task SyncSetAsync_新页面写入知识库并入队索引与图谱()
    {
        var (service, unitOfWork, coordinator) = CreateService();
        var project = new ManagedProject { Id = Guid.NewGuid(), Name = "Hetu" };
        var document = CreateDocument(project.Id, "架构总览", "正文");

        unitOfWork.ManagedProjects.FindAsync(
                Arg.Any<Expression<Func<ManagedProject, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<ManagedProject>>([project]));
        var added = new List<KnowledgeItem>();
        unitOfWork.KnowledgeItems.AddAsync(Arg.Any<KnowledgeItem>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var item = call.Arg<KnowledgeItem>();
                added.Add(item);
                return Task.FromResult(item);
            });

        var result = await service.SyncSetAsync([document]);

        var item = Assert.Single(added);
        Assert.Equal(KnowledgeItemType.Wiki, item.Type);
        Assert.Equal(document.Id, item.WikiDocumentId);
        Assert.Equal("架构总览", item.Title);
        Assert.Contains("Hetu · 架构总览", item.Content);
        Assert.Contains("正文", item.Content);
        Assert.Equal(1, result.CreatedItems);
        Assert.Equal(1, result.QueuedIndexTasks);
        Assert.Equal(1, result.QueuedGraphTasks);
        await coordinator.Received(1).EnqueueBatchAsync(
            Arg.Is<IReadOnlyCollection<BackgroundTaskRequest>>(requests =>
                requests.Count == 1 && requests.All(r => r.Type == BackgroundTaskType.GenerateKnowledgeItemEmbedding)),
            Arg.Any<CancellationToken>());
        await coordinator.Received(1).EnqueueBatchAsync(
            Arg.Is<IReadOnlyCollection<BackgroundTaskRequest>>(requests =>
                requests.Count == 1 && requests.All(r => r.Type == BackgroundTaskType.WikiGraphExtract && r.EntityId == document.Id)),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SyncSetAsync_已有投影只更新内容不重复创建()
    {
        var (service, unitOfWork, _) = CreateService();
        var document = CreateDocument(Guid.NewGuid(), "架构总览", "新正文");
        var existing = new KnowledgeItem
        {
            Id = Guid.NewGuid(),
            Type = KnowledgeItemType.Wiki,
            Title = "旧标题",
            Content = "旧正文",
            WikiDocumentId = document.Id,
        };
        unitOfWork.KnowledgeItems.FindAsync(
                Arg.Any<Expression<Func<KnowledgeItem, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<KnowledgeItem>>([existing]));

        var result = await service.SyncSetAsync([document]);

        await unitOfWork.KnowledgeItems.DidNotReceive()
            .AddAsync(Arg.Any<KnowledgeItem>(), Arg.Any<CancellationToken>());
        await unitOfWork.KnowledgeItems.Received(1)
            .UpdateAsync(Arg.Is<KnowledgeItem>(k => k.Id == existing.Id && k.Title == document.Title), Arg.Any<CancellationToken>());
        Assert.Equal(0, result.CreatedItems);
        Assert.Contains("新正文", existing.Content);
    }

    [Fact]
    public async Task SyncSetAsync_未配置模型时仍写入投影但不入队任务()
    {
        var (service, unitOfWork, coordinator, _, _) = CreateServiceCore(embedding: false, graph: false);
        unitOfWork.KnowledgeItems.AddAsync(Arg.Any<KnowledgeItem>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(call.Arg<KnowledgeItem>()));
        var document = CreateDocument(Guid.NewGuid(), "总览", "正文");

        var result = await service.SyncSetAsync([document]);

        Assert.Equal(1, result.CreatedItems);
        Assert.Equal(0, result.QueuedIndexTasks);
        Assert.Equal(0, result.QueuedGraphTasks);
        Assert.False(result.EmbeddingConfigured);
        Assert.False(result.GraphConfigured);
        await coordinator.DidNotReceive()
            .EnqueueBatchAsync(Arg.Any<IReadOnlyCollection<BackgroundTaskRequest>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RemoveSetAsync_删除投影分块并清理图谱()
    {
        var (service, unitOfWork, _, graph, _) = CreateServiceCore(embedding: true, graph: true);
        var wikiId = Guid.NewGuid();
        var item = new KnowledgeItem
        {
            Id = Guid.NewGuid(),
            Type = KnowledgeItemType.Wiki,
            Title = "总览",
            Content = "正文",
            WikiDocumentId = wikiId,
        };
        unitOfWork.KnowledgeItems.FindAsync(
                Arg.Any<Expression<Func<KnowledgeItem, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<KnowledgeItem>>([item]));

        await service.RemoveSetAsync([wikiId]);

        await unitOfWork.KnowledgeItems.Received(1).DeleteChunksAsync(item.Id, Arg.Any<CancellationToken>());
        await unitOfWork.KnowledgeItems.Received(1).DeleteAsync(item, Arg.Any<CancellationToken>());
        await graph.Received(1).CleanUpByWikiDocumentIdsAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 1 && ids.Contains(wikiId)),
            Arg.Any<CancellationToken>());
    }

    private static WikiDocument CreateDocument(Guid projectId, string title, string content) => new()
    {
        Id = Guid.NewGuid(),
        ProjectId = projectId,
        SetId = Guid.NewGuid(),
        Title = title,
        Content = content,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private static (WikiKnowledgeSyncService Service, IUnitOfWork UnitOfWork, IBackgroundTaskCoordinator Coordinator)
        CreateService()
    {
        var (service, unitOfWork, coordinator, _, _) = CreateServiceCore(embedding: true, graph: true);
        return (service, unitOfWork, coordinator);
    }

    private static (WikiKnowledgeSyncService Service, IUnitOfWork UnitOfWork, IBackgroundTaskCoordinator Coordinator,
        IGraphService Graph, IWikiKnowledgeSyncService Self) CreateServiceCore(bool embedding, bool graph)
    {
        var unitOfWork = Substitute.For<IUnitOfWork>();
        unitOfWork.ManagedProjects.FindAsync(
                Arg.Any<Expression<Func<ManagedProject, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<ManagedProject>>([]));
        unitOfWork.KnowledgeItems.FindAsync(
                Arg.Any<Expression<Func<KnowledgeItem, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<KnowledgeItem>>([]));
        unitOfWork.SaveChangesAsync(Arg.Any<CancellationToken>()).Returns(1);
        unitOfWork.KnowledgeItems.DeleteAsync(Arg.Any<KnowledgeItem>(), Arg.Any<CancellationToken>())
            .Returns(Task.CompletedTask);
        unitOfWork.KnowledgeItems.UpdateAsync(Arg.Any<KnowledgeItem>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(call.Arg<KnowledgeItem>()));

        var coordinator = Substitute.For<IBackgroundTaskCoordinator>();
        coordinator.EnqueueBatchAsync(Arg.Any<IReadOnlyCollection<BackgroundTaskRequest>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(new BackgroundTaskEnqueueResult(
                call.Arg<IReadOnlyCollection<BackgroundTaskRequest>>().Count, 0)));

        var embeddingFactory = Substitute.For<IEmbeddingProviderFactory>();
        embeddingFactory.CreateEmbeddingProviderAsync(Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(embedding ? Substitute.For<IEmbeddingProvider>() : null));

        var llmFactory = Substitute.For<ILLMProviderFactory>();
        llmFactory.CreateScenarioProviderAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(graph ? Substitute.For<ILLMProvider>() : null));
        llmFactory.CreateChatProviderAsync(Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(graph ? Substitute.For<ILLMProvider>() : null));

        var graphService = Substitute.For<IGraphService>();
        var service = new WikiKnowledgeSyncService(
            unitOfWork,
            coordinator,
            embeddingFactory,
            llmFactory,
            graphService,
            Substitute.For<ILogger<WikiKnowledgeSyncService>>());

        return (service, unitOfWork, coordinator, graphService, service);
    }
}
