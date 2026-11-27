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