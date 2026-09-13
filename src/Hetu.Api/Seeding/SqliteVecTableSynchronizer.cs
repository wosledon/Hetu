using System.Data;
using System.Data.Common;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Api.Seeding;

/// <summary>
/// SQLite 下 sqlite-vec 虚表由扩展在运行时创建、不参与 EF 迁移，历史数据可能尚未写入向量。
/// 启动时把 <c>NoteEmbeddings</c> / <c>NoteChunkEmbeddings</c> 全量回填到 vec 虚表。
/// vec 扩展不可用时静默跳过，语义搜索会自行回退到内存计算。
/// </summary>
internal static class SqliteVecTableSynchronizer
{
    public static async Task SyncAsync(HetuDbContext db)
    {
        try
        {
            var connection = db.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open)
                await connection.OpenAsync();

            await BackfillAsync(
                connection,
                vecTable: "vec_note_embeddings",
                idColumn: "note_id",
                entities: db.NoteEmbeddings.AsNoTracking().AsAsyncEnumerable(),
                selector: e => (e.NoteId, e.Embedding));

            await BackfillAsync(
                connection,
                vecTable: "vec_chunk_embeddings",
                idColumn: "chunk_id",
                entities: db.NoteChunkEmbeddings.AsNoTracking().AsAsyncEnumerable(),
                selector: e => (e.ChunkId, e.Embedding));

            // 项目代码索引分块：列名不同（ChunkId 即 WorkCodeChunk.Id）
            await BackfillAsync(
                connection,
                vecTable: "vec_work_code_chunks",
                idColumn: "chunk_id",
                entities: db.WorkCodeChunks.AsNoTracking().AsAsyncEnumerable(),
                selector: e => (e.Id, e.Embedding));
        }
        catch
        {
            // vec 表不可用时忽略，搜索会回退到内存计算
        }
    }

    private static async Task BackfillAsync<TEntity>(
        DbConnection connection,
        string vecTable,
        string idColumn,
        IAsyncEnumerable<TEntity> entities,
        Func<TEntity, (Guid Id, byte[] Embedding)> selector)
    {
        if (!await TableExistsAsync(connection, vecTable)) return;

        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"INSERT OR REPLACE INTO {vecTable} ({idColumn}, embedding) VALUES (@id, @embedding)";

        var idParameter = command.CreateParameter();
        idParameter.ParameterName = "id";
        var embeddingParameter = command.CreateParameter();
        embeddingParameter.ParameterName = "embedding";
        command.Parameters.Add(idParameter);
        command.Parameters.Add(embeddingParameter);

        await foreach (var entity in entities)
        {
            var (id, embedding) = selector(entity);
            try
            {
                idParameter.Value = id.ToString();
                embeddingParameter.Value = ToVectorLiteral(embedding);
                await command.ExecuteNonQueryAsync();
            }
            catch
            {
                // 单条失败不影响其他
            }
        }

        await transaction.CommitAsync();
    }

    private static async Task<bool> TableExistsAsync(DbConnection connection, string tableName)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE name = @name AND type = 'table'";
        command.Parameters.Add(new Microsoft.Data.Sqlite.SqliteParameter("name", tableName));
        return await command.ExecuteScalarAsync() is long count && count > 0;
    }

    /// <summary>把浮点向量按 sqlite-vec 期望的 JSON 数组字面量格式（<c>[0.1,0.2]</c>）序列化。</summary>
    private static string ToVectorLiteral(byte[] embedding)
    {
        var floats = new float[embedding.Length / sizeof(float)];
        Buffer.BlockCopy(embedding, 0, floats, 0, floats.Length * sizeof(float));
        return $"[{string.Join(",", floats)}]";
    }
}
