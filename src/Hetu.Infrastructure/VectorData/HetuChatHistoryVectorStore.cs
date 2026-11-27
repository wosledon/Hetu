using System.Collections.Concurrent;
using System.Data;
using System.Data.Common;
using System.Linq.Expressions;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.VectorData;

namespace Hetu.Infrastructure.VectorData;

/// <summary>
/// 本地优先的 ChatHistoryMemoryProvider 向量存储：消息与 embedding 存在同一 SQLite/PostgreSQL
/// 元数据表里，检索在内存中做余弦相似度。避免额外引入独立向量库进程。
/// </summary>
public sealed class HetuChatHistoryVectorStore : VectorStore
{
    private const string DefaultCollection = "agent_chat_history";
    private readonly HetuDbContext _context;
    private readonly IEmbeddingProviderFactory _embeddingFactory;
    private readonly DatabaseProviderInfo _database;
    private readonly ILogger<HetuChatHistoryVectorStore> _logger;
    private readonly ConcurrentDictionary<string, VectorStoreCollection<object, Dictionary<string, object?>>> _collections = new(StringComparer.Ordinal);

    public HetuChatHistoryVectorStore(
        HetuDbContext context,
        IEmbeddingProviderFactory embeddingFactory,
        DatabaseProviderInfo database,
        ILogger<HetuChatHistoryVectorStore> logger)
    {
        _context = context;
        _embeddingFactory = embeddingFactory;
        _database = database;
        _logger = logger;
    }

    public override VectorStoreCollection<TKey, TRecord> GetCollection<TKey, TRecord>(
        string name,
        VectorStoreCollectionDefinition? definition = null)
        => throw new NotSupportedException("Hetu 的 ChatHistoryMemory 只使用动态集合。");

    public override VectorStoreCollection<object, Dictionary<string, object?>> GetDynamicCollection(
        string name,
        VectorStoreCollectionDefinition definition)
        => _collections.GetOrAdd(
            string.IsNullOrWhiteSpace(name) ? DefaultCollection : name,
            value => new HetuChatHistoryCollection(this, value));

    public override async IAsyncEnumerable<string> ListCollectionNamesAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        yield return DefaultCollection;
    }

    public override async Task<bool> CollectionExistsAsync(string name, CancellationToken cancellationToken = default)
    {
        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = _database.IsPostgreSql
            ? "SELECT to_regclass(quote_ident(@table)) IS NOT NULL"
            : "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = @table";
        AddParameter(command, "@table", TableName(name));
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return _database.IsPostgreSql
            ? value is true
            : value is long or int && Convert.ToInt64(value) > 0;
    }

    public override async Task EnsureCollectionDeletedAsync(string name, CancellationToken cancellationToken = default)
    {
        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP TABLE IF EXISTS {Quote(TableName(name))}";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public override object? GetService(Type serviceType, object? serviceKey = null)
        => serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;

    internal async Task EnsureCollectionExistsAsync(string name, CancellationToken cancellationToken)
    {
        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            CREATE TABLE IF NOT EXISTS {Quote(TableName(name))} (
                "Key" TEXT PRIMARY KEY,
                "Role" TEXT,
                "MessageId" TEXT,
                "AuthorName" TEXT,
                "ApplicationId" TEXT,
                "AgentId" TEXT,
                "UserId" TEXT,
                "SessionId" TEXT,
                "Content" TEXT,
                "CreatedAt" TEXT,
                "EmbeddingJson" TEXT
            )
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    internal async Task UpsertAsync(string name, IReadOnlyList<Dictionary<string, object?>> records, CancellationToken ct)
    {
        if (records.Count == 0) return;
        var embedding = await _embeddingFactory.CreateEmbeddingProviderAsync(ct)
                        ?? throw new InvalidOperationException("没有可用的 Embedding 模型，无法写入会话记忆");
        var vectors = await embedding.EmbedAsync(records.Select(GetContent).ToList(), ct);

        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        try
        {
            for (var i = 0; i < records.Count; i++)
            {
                var record = records[i];
                await UpsertOneAsync(connection, transaction, name, record, vectors[i], ct);
            }
            await transaction.CommitAsync(ct);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(ct);
            _logger.LogWarning(ex, "[HistoryMemory] 写入会话向量失败 collection={Collection}", name);
            throw;
        }
    }

    internal async Task<IReadOnlyList<(Dictionary<string, object?> Record, double? Score)>> SearchAsync(
        string name,
        string queryText,
        int top,
        Expression<Func<Dictionary<string, object?>, bool>>? filter,
        CancellationToken ct)
    {
        var embedding = await _embeddingFactory.CreateEmbeddingProviderAsync(ct)
                        ?? throw new InvalidOperationException("没有可用的 Embedding 模型，无法检索会话记忆");
        var query = await embedding.EmbedAsync(queryText, ct);
        var rows = await LoadAllAsync(name, filter, ct);
        var results = new List<(Dictionary<string, object?>, double?)>(rows.Count);
        foreach (var row in rows)
        {
            var vector = ReadVector(row);
            if (vector.Length == 0 || vector.Length != query.Length) continue;
            results.Add((row, Cosine(query, vector)));
        }
        return results
            .OrderByDescending(item => item.Item2)
            .Take(Math.Max(1, top))
            .ToList();
    }

    internal async Task<IReadOnlyList<Dictionary<string, object?>>> LoadAsync(
        string name,
        Expression<Func<Dictionary<string, object?>, bool>>? filter,
        int? top,
        CancellationToken ct)
    {
        var rows = await LoadAllAsync(name, filter, ct);
        return top is > 0 ? rows.Take(top.Value).ToList() : rows;
    }

    internal async Task DeleteAsync(string name, IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        if (keys.Count == 0) return;
        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        var placeholders = string.Join(",", keys.Select((_, i) => $"@k{i}"));
        command.CommandText = $"DELETE FROM {Quote(TableName(name))} WHERE \"Key\" IN ({placeholders})";
        var index = 0;
        foreach (var key in keys) AddParameter(command, $"@k{index++}", key);
        await command.ExecuteNonQueryAsync(ct);
    }

    private async Task UpsertOneAsync(
        DbConnection connection,
        DbTransaction transaction,
        string name,
        Dictionary<string, object?> record,
        float[] vector,
        CancellationToken ct)
    {
        var table = Quote(TableName(name));
        var key = GetKey(record);
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = $"DELETE FROM {table} WHERE \"Key\" = @key";
            AddParameter(delete, "@key", key);
            await delete.ExecuteNonQueryAsync(ct);
        }

        await using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = $"""
            INSERT INTO {table} (
                "Key","Role","MessageId","AuthorName","ApplicationId","AgentId","UserId","SessionId","Content","CreatedAt","EmbeddingJson"
            ) VALUES (
                @key,@role,@messageId,@authorName,@applicationId,@agentId,@userId,@sessionId,@content,@createdAt,@embedding
            )
            """;
        AddParameter(insert, "@key", key);
        AddParameter(insert, "@role", GetString(record, "Role"));
        AddParameter(insert, "@messageId", GetString(record, "MessageId"));
        AddParameter(insert, "@authorName", GetString(record, "AuthorName"));
        AddParameter(insert, "@applicationId", GetString(record, "ApplicationId"));
        AddParameter(insert, "@agentId", GetString(record, "AgentId"));
        AddParameter(insert, "@userId", GetString(record, "UserId"));
        AddParameter(insert, "@sessionId", GetString(record, "SessionId"));
        AddParameter(insert, "@content", GetContent(record));
        AddParameter(insert, "@createdAt", GetString(record, "CreatedAt"));
        AddParameter(insert, "@embedding", JsonSerializer.Serialize(vector));
        await insert.ExecuteNonQueryAsync(ct);
    }

    private async Task<List<Dictionary<string, object?>>> LoadAllAsync(
        string name,
        Expression<Func<Dictionary<string, object?>, bool>>? filter,
        CancellationToken ct)
    {
        await EnsureCollectionExistsAsync(name, ct);
        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT "Key","Role","MessageId","AuthorName","ApplicationId","AgentId","UserId","SessionId","Content","CreatedAt","EmbeddingJson"
            FROM {Quote(TableName(name))}
            """;
        var rows = new List<Dictionary<string, object?>>();
        var predicate = filter?.Compile();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var row = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["Key"] = reader.GetString(0),
                ["Role"] = reader.IsDBNull(1) ? null : reader.GetString(1),
                ["MessageId"] = reader.IsDBNull(2) ? null : reader.GetString(2),
                ["AuthorName"] = reader.IsDBNull(3) ? null : reader.GetString(3),
                ["ApplicationId"] = reader.IsDBNull(4) ? null : reader.GetString(4),
                ["AgentId"] = reader.IsDBNull(5) ? null : reader.GetString(5),
                ["UserId"] = reader.IsDBNull(6) ? null : reader.GetString(6),
                ["SessionId"] = reader.IsDBNull(7) ? null : reader.GetString(7),
                ["Content"] = reader.IsDBNull(8) ? null : reader.GetString(8),
                ["CreatedAt"] = reader.IsDBNull(9) ? null : reader.GetString(9),
                ["EmbeddingJson"] = reader.IsDBNull(10) ? null : reader.GetString(10),
            };
            if (predicate is null || predicate(row)) rows.Add(row);
        }
        return rows;
    }

    private static string GetKey(Dictionary<string, object?> record)
        => record.TryGetValue("Key", out var key) && key is not null
            ? key.ToString() ?? Guid.NewGuid().ToString("N")
            : Guid.NewGuid().ToString("N");

    private static string GetContent(Dictionary<string, object?> record)
        => record.TryGetValue("Content", out var content) ? content?.ToString() ?? string.Empty : string.Empty;

    private static string? GetString(Dictionary<string, object?> record, string key)
        => record.TryGetValue(key, out var value) ? value?.ToString() : null;

    private static float[] ReadVector(Dictionary<string, object?> record)
    {
        if (!record.TryGetValue("EmbeddingJson", out var raw) || raw is not string json) return [];
        try { return JsonSerializer.Deserialize<float[]>(json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static double Cosine(float[] a, float[] b)
    {
        double dot = 0, normA = 0, normB = 0;
        for (var i = 0; i < a.Length; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return normA > 0 && normB > 0 ? dot / Math.Sqrt(normA * normB) : 0;
    }

    private static void AddParameter(DbCommand command, string name, object? value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value ?? DBNull.Value;
        command.Parameters.Add(parameter);
    }

    private static string TableName(string name)
        => "AgentChatHistoryVectors_" + new string(name.Where(char.IsLetterOrDigit).ToArray());

    private static string Quote(string identifier) => $"\"{identifier}\"";

    private sealed class HetuChatHistoryCollection : VectorStoreCollection<object, Dictionary<string, object?>>
    {
        private readonly HetuChatHistoryVectorStore _store;
        private readonly string _name;

        public HetuChatHistoryCollection(HetuChatHistoryVectorStore store, string name)
        {
            _store = store;
            _name = name;
        }

        public override string Name => _name;

        public override Task<bool> CollectionExistsAsync(CancellationToken cancellationToken = default)
            => _store.CollectionExistsAsync(_name, cancellationToken);

        public override Task EnsureCollectionExistsAsync(CancellationToken cancellationToken = default)
            => _store.EnsureCollectionExistsAsync(_name, cancellationToken);

        public override Task EnsureCollectionDeletedAsync(CancellationToken cancellationToken = default)
            => _store.EnsureCollectionDeletedAsync(_name, cancellationToken);

        public override async Task<Dictionary<string, object?>?> GetAsync(
            object key,
            RecordRetrievalOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            var rows = await _store.LoadAsync(_name, null, null, cancellationToken);
            return rows.FirstOrDefault(row =>
                string.Equals(GetKey(row), key.ToString(), StringComparison.Ordinal));
        }

        public override async IAsyncEnumerable<Dictionary<string, object?>> GetAsync(
            IEnumerable<object> keys,
            RecordRetrievalOptions? options = null,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var wanted = keys.Select(key => key.ToString()).ToHashSet(StringComparer.Ordinal);
            await foreach (var item in GetAsync(row => wanted.Contains(GetKey(row)), wanted.Count, null, cancellationToken))
                yield return item;
        }

        public override IAsyncEnumerable<Dictionary<string, object?>> GetAsync(
            Expression<Func<Dictionary<string, object?>, bool>> filter,
            int top,
            FilteredRecordRetrievalOptions<Dictionary<string, object?>>? options = null,
            CancellationToken cancellationToken = default)
            => ToAsync(_store.LoadAsync(_name, filter, top, cancellationToken));

        public override Task DeleteAsync(object key, CancellationToken cancellationToken = default)
            => _store.DeleteAsync(_name, [key.ToString() ?? string.Empty], cancellationToken);

        public override Task DeleteAsync(IEnumerable<object> keys, CancellationToken cancellationToken = default)
            => _store.DeleteAsync(_name, keys.Select(key => key.ToString() ?? string.Empty).ToList(), cancellationToken);

        public override Task UpsertAsync(Dictionary<string, object?> record, CancellationToken cancellationToken = default)
            => _store.UpsertAsync(_name, [record], cancellationToken);

        public override Task UpsertAsync(IEnumerable<Dictionary<string, object?>> records, CancellationToken cancellationToken = default)
            => _store.UpsertAsync(_name, records.ToList(), cancellationToken);

        public override async IAsyncEnumerable<VectorSearchResult<Dictionary<string, object?>>> SearchAsync<TInput>(
            TInput searchValue,
            int top,
            VectorSearchOptions<Dictionary<string, object?>>? options = null,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            if (searchValue is not string text)
                throw new NotSupportedException("Hetu 会话记忆只支持文本查询。");
            var results = await _store.SearchAsync(_name, text, top, options?.Filter, cancellationToken);
            foreach (var (record, score) in results)
                yield return new VectorSearchResult<Dictionary<string, object?>>(record, score);
        }

        public override object? GetService(Type serviceType, object? serviceKey = null)
            => serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;

        private static async IAsyncEnumerable<Dictionary<string, object?>> ToAsync(
            Task<IReadOnlyList<Dictionary<string, object?>>> task)
        {
            foreach (var item in await task) yield return item;
        }
    }
}