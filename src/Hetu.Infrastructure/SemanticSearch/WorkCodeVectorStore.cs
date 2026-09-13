using System.Data;
using System.Data.Common;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Pgvector;

namespace Hetu.Infrastructure.SemanticSearch;

/// <summary>
/// 代码索引向量存储：
/// <list type="bullet">
/// <item>SQLite：写入 sqlite-vec 虚表 <c>vec_work_code_chunks</c>，检索走扩展的 KNN。</item>
/// <item>PostgreSQL：沿用 <c>WorkCodeChunks.Vector</c> 列，检索走 pgvector 的 <c>&lt;=&gt;</c> 距离排序。</item>
/// </list>
/// 任一环节失败都只记日志并返回 null/-1，调用方回退到内存余弦计算，保证检索功能不中断。
/// </summary>
public class WorkCodeVectorStore : IWorkCodeVectorStore
{
    private const string VecTable = "vec_work_code_chunks";
    private const int MaxConsecutiveFailures = 3;

    private readonly HetuDbContext _context;
    private readonly ILogger<WorkCodeVectorStore> _logger;

    public WorkCodeVectorStore(HetuDbContext context, ILogger<WorkCodeVectorStore> logger)
    {
        _context = context;
        _logger = logger;
    }

    private bool IsSqlite => _context.Database.IsSqlite();

    public async Task UpsertAsync(IReadOnlyList<WorkCodeChunk> chunks, CancellationToken cancellationToken = default)
    {
        if (!IsSqlite || chunks.Count == 0) return;

        var connection = _context.Database.GetDbConnection();
        var opened = await OpenAsync(connection, cancellationToken);
        DbTransaction? transaction = null;
        try
        {
            transaction = TryBeginTransaction(connection);

            await using var command = connection.CreateCommand();
            // sqlite-vec 虚表不支持 REPLACE 冲突处理（会抛 UNIQUE 约束），必须显式删除后插入
            command.CommandText =
                $"DELETE FROM {VecTable} WHERE chunk_id = @id;" +
                $"INSERT INTO {VecTable} (chunk_id, embedding) VALUES (@id, @embedding);";
            command.Transaction = transaction;
            var idParameter = command.CreateParameter();
            idParameter.ParameterName = "id";
            var vectorParameter = command.CreateParameter();
            vectorParameter.ParameterName = "embedding";
            command.Parameters.Add(idParameter);
            command.Parameters.Add(vectorParameter);

            var consecutiveFailures = 0;
            foreach (var chunk in chunks)
            {
                var vector = ResolveVector(chunk);
                if (vector.Length == 0) continue;
                try
                {
                    idParameter.Value = chunk.Id.ToString();
                    vectorParameter.Value = $"[{string.Join(",", vector)}]";
                    await command.ExecuteNonQueryAsync(cancellationToken);
                    consecutiveFailures = 0;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // 单条失败（例如维度与虚表不一致）不影响其余分块
                    _logger.LogDebug(ex, "[WorkCodeVectorStore] 写入向量失败 chunkId={ChunkId}", chunk.Id);
                    if (++consecutiveFailures >= MaxConsecutiveFailures)
                    {
                        _logger.LogWarning(
                            ex,
                            "[WorkCodeVectorStore] 向量写入连续失败 {Count} 次，中止本批（维度配置可能不匹配）",
                            consecutiveFailures);
                        break;
                    }
                }
            }

            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "[WorkCodeVectorStore] 批量写入向量失败");
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
            if (opened) await connection.CloseAsync();
        }
    }

    /// <summary>连接已在事务中时返回 null，避免嵌套事务异常。</summary>
    private static DbTransaction? TryBeginTransaction(DbConnection connection)
    {
        try
        {
            return connection.BeginTransaction();
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    public async Task DeleteAsync(IReadOnlyList<Guid> chunkIds, CancellationToken cancellationToken = default)
    {
        if (!IsSqlite || chunkIds.Count == 0) return;

        var connection = _context.Database.GetDbConnection();
        var opened = await OpenAsync(connection, cancellationToken);
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"DELETE FROM {VecTable} WHERE chunk_id = @id";
            var idParameter = command.CreateParameter();
            idParameter.ParameterName = "id";
            command.Parameters.Add(idParameter);

            foreach (var id in chunkIds)
            {
                try
                {
                    idParameter.Value = id.ToString();
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogDebug(ex, "[WorkCodeVectorStore] 删除向量失败 chunkId={ChunkId}", id);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "[WorkCodeVectorStore] 批量删除向量失败");
        }
        finally
        {
            if (opened) await connection.CloseAsync();
        }
    }

    public async Task<IReadOnlyList<Guid>?> SearchAsync(
        Guid projectId,
        float[] queryVector,
        int topK,
        CancellationToken cancellationToken = default)
    {
        if (queryVector.Length == 0 || topK <= 0) return [];

        return IsSqlite
            ? await SearchSqliteAsync(queryVector, topK, cancellationToken)
            : await SearchPostgresAsync(projectId, queryVector, topK, cancellationToken);
    }

    public async Task<int> CountAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var connection = _context.Database.GetDbConnection();
        var sql = IsSqlite
            // vec 虚表无项目列（与既有 note/chunk/memory 表保持一致），这里返回已同步的分块总数
            ? $"SELECT COUNT(*) FROM {VecTable}"
            : @"SELECT COUNT(*) FROM ""WorkCodeChunks"" WHERE ""ProjectId"" = @projectId";

        var opened = await OpenAsync(connection, cancellationToken);
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            if (!IsSqlite)
                command.Parameters.Add(new NpgsqlParameter("projectId", projectId));

            var result = await command.ExecuteScalarAsync(cancellationToken);
            return result == null || result == DBNull.Value ? -1 : Convert.ToInt32(result);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "[WorkCodeVectorStore] 读取向量数量失败");
            return -1;
        }
        finally
        {
            if (opened) await connection.CloseAsync();
        }
    }

    /// <summary>sqlite-vec KNN：k 取 topK 的若干倍以抵消多项目共用一张虚表带来的过滤损耗</summary>
    private async Task<IReadOnlyList<Guid>?> SearchSqliteAsync(float[] queryVector, int topK, CancellationToken cancellationToken)
    {
        var connection = _context.Database.GetDbConnection();
        var fetchK = Math.Clamp(topK * 5, 20, 200);
        var opened = await OpenAsync(connection, cancellationToken);
        try
        {
            await using var command = connection.CreateCommand();
            // k = ? 与 LIMIT 不能共存，取候选后由调用方按 topK 截断
            command.CommandText =
                $"SELECT chunk_id FROM {VecTable} WHERE embedding MATCH @query AND k = @fetchK ORDER BY distance";
            command.Parameters.Add(new SqliteParameter("query", $"[{string.Join(",", queryVector)}]"));
            command.Parameters.Add(new SqliteParameter("fetchK", fetchK));

            var ids = new List<Guid>();
            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                if (Guid.TryParse(reader.GetString(0), out var id)) ids.Add(id);
            }
            return ids;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 扩展未加载、虚表未创建或维度不一致：交给调用方回退内存计算
            _logger.LogDebug(ex, "[WorkCodeVectorStore] sqlite-vec 检索不可用，回退内存计算");
            return null;
        }
        finally
        {
            if (opened) await connection.CloseAsync();
        }
    }

    /// <summary>pgvector 检索：直接按余弦距离排序取 topK</summary>
    private async Task<IReadOnlyList<Guid>?> SearchPostgresAsync(
        Guid projectId,
        float[] queryVector,
        int topK,
        CancellationToken cancellationToken)
    {
        var connection = _context.Database.GetDbConnection();
        var opened = await OpenAsync(connection, cancellationToken);
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $@"
                SELECT ""Id"" FROM ""WorkCodeChunks""
                WHERE ""ProjectId"" = @projectId
                ORDER BY ""Vector"" <=> @query
                LIMIT @topK";
            command.Parameters.Add(new NpgsqlParameter("projectId", projectId));
            command.Parameters.Add(new NpgsqlParameter("query", new Vector(queryVector)));
            command.Parameters.Add(new NpgsqlParameter("topK", topK));

            var ids = new List<Guid>();
            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                ids.Add(reader.GetGuid(0));
            }
            return ids;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // pgvector 不可用（扩展缺失或列未映射）：交给调用方回退内存计算
            _logger.LogDebug(ex, "[WorkCodeVectorStore] pgvector 检索不可用，回退内存计算");
            return null;
        }
        finally
        {
            if (opened) await connection.CloseAsync();
        }
    }

    private static async Task<bool> OpenAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        if (connection.State == ConnectionState.Open) return false;
        await connection.OpenAsync(cancellationToken);
        return true;
    }

    private static float[] ResolveVector(WorkCodeChunk chunk)
    {
        if (chunk.Vector.Length > 0) return chunk.Vector;
        if (chunk.Embedding.Length == 0) return [];

        var floats = new float[chunk.Embedding.Length / sizeof(float)];
        Buffer.BlockCopy(chunk.Embedding, 0, floats, 0, floats.Length * sizeof(float));
        return floats;
    }
}
