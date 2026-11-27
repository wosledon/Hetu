using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Hetu.Infrastructure.VectorData;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.VectorData;
using NSubstitute;

namespace Hetu.Core.Tests;

public class HetuChatHistoryVectorStoreTests
{
    [Fact]
    public async Task UpsertAndSearch_返回最相似记录()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<HetuDbContext>()
            .UseSqlite(connection)
            .Options;
        await using var db = new HetuDbContext(options);

        var embedding = new FakeEmbeddingProvider();
        var factory = Substitute.For<IEmbeddingProviderFactory>();
        factory.CreateEmbeddingProviderAsync(Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IEmbeddingProvider?>(embedding));
        var store = new HetuChatHistoryVectorStore(
            db,
            factory,
            new DatabaseProviderInfo(DatabaseProviderInfo.Sqlite, "DataSource=:memory:"),
            NullLogger<HetuChatHistoryVectorStore>.Instance);

        var collection = store.GetDynamicCollection("test_memory", new VectorStoreCollectionDefinition());
        await collection.EnsureCollectionExistsAsync();
        await collection.UpsertAsync(new Dictionary<string, object?>
        {
            ["Key"] = Guid.NewGuid().ToString("N"),
            ["Role"] = "user",
            ["Content"] = "alpha hello",
            ["ContentEmbedding"] = "alpha hello",
        });
        await collection.UpsertAsync(new Dictionary<string, object?>
        {
            ["Key"] = Guid.NewGuid().ToString("N"),
            ["Role"] = "assistant",
            ["Content"] = "beta world",
            ["ContentEmbedding"] = "beta world",
        });

        var results = new List<VectorSearchResult<Dictionary<string, object?>>>();
        await foreach (var result in collection.SearchAsync("alpha hello", 5))
            results.Add(result);

        Assert.NotEmpty(results);
        Assert.Contains("alpha", results[0].Record["Content"]?.ToString());
    }

    [Fact]
    public async Task PruneAsync_过期记录_同时清理元数据()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<HetuDbContext>()
            .UseSqlite(connection)
            .Options;
        await using var db = new HetuDbContext(options);

        var factory = Substitute.For<IEmbeddingProviderFactory>();
        factory.CreateEmbeddingProviderAsync(Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IEmbeddingProvider?>(new FakeEmbeddingProvider()));
        var store = new HetuChatHistoryVectorStore(
            db,
            factory,
            new DatabaseProviderInfo(DatabaseProviderInfo.Sqlite, "DataSource=:memory:"),
            NullLogger<HetuChatHistoryVectorStore>.Instance);

        var key = Guid.NewGuid().ToString("N");
        var collection = store.GetDynamicCollection(HetuChatHistoryVectorStore.DefaultCollectionName, new VectorStoreCollectionDefinition());
        await collection.EnsureCollectionExistsAsync();
        await collection.UpsertAsync(new Dictionary<string, object?>
        {
            ["Key"] = key,
            ["Role"] = "user",
            ["Content"] = "old message",
            ["CreatedAt"] = DateTimeOffset.UtcNow.AddDays(-40).ToString("O"),
        });

        var removed = await store.PruneAsync(DateTimeOffset.UtcNow.AddDays(-30));

        Assert.Equal(1, removed);
        Assert.Null(await collection.GetAsync(key));
    }

    [Fact]
    public async Task PruneAsync_向量表不存在_直接返回零且不要求Embedding()
    {
        await using var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<HetuDbContext>()
            .UseSqlite(connection)
            .Options;
        await using var db = new HetuDbContext(options);

        var factory = Substitute.For<IEmbeddingProviderFactory>();
        factory.CreateEmbeddingProviderAsync(Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IEmbeddingProvider?>(null));
        var store = new HetuChatHistoryVectorStore(
            db,
            factory,
            new DatabaseProviderInfo(DatabaseProviderInfo.Sqlite, "DataSource=:memory:"),
            NullLogger<HetuChatHistoryVectorStore>.Instance);

        var removed = await store.PruneAsync(DateTimeOffset.UtcNow.AddDays(-30));

        Assert.Equal(0, removed);
        await factory.DidNotReceive().CreateEmbeddingProviderAsync(Arg.Any<CancellationToken>());
    }

    private sealed class FakeEmbeddingProvider : IEmbeddingProvider
    {
        public int Dimensions => 2;

        public Task<float[]> EmbedAsync(string text, CancellationToken cancellationToken = default)
            => Task.FromResult(text.Contains("alpha", StringComparison.OrdinalIgnoreCase)
                ? new[] { 1f, 0f }
                : new[] { 0f, 1f });

        public Task<float[][]> EmbedAsync(IReadOnlyList<string> texts, CancellationToken cancellationToken = default)
            => Task.FromResult(texts.Select(text =>
                text.Contains("alpha", StringComparison.OrdinalIgnoreCase)
                    ? new[] { 1f, 0f }
                    : new[] { 0f, 1f }).ToArray());
    }
}