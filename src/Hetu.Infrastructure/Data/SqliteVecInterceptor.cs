using System.Data.Common;
using System.Threading;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;

namespace Hetu.Infrastructure.Data;

public class SqliteVecInterceptor : DbConnectionInterceptor
{
    private static readonly SemaphoreSlim s_initLock = new(1, 1);
    private static int s_cachedDimensions;
    private static bool s_initialized;

    private readonly string _extensionPath;
    private readonly int _fallbackDimensions;

    public SqliteVecInterceptor(IConfiguration configuration)
    {
        var configuredPath = configuration["Sqlite:VecExtensionPath"];
        _extensionPath = !string.IsNullOrWhiteSpace(configuredPath)
            ? configuredPath
            : Path.Combine(AppContext.BaseDirectory, "sqlite-vec", "vec0.dll");
        _fallbackDimensions = configuration.GetValue<int?>("Embedding:Dimensions") ?? 1536;
    }

    public override async Task ConnectionOpenedAsync(
        DbConnection connection,
        ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        if (connection is not SqliteConnection sqliteConnection) return;
        if (!File.Exists(_extensionPath)) return;

        await s_initLock.WaitAsync(cancellationToken);
        try
        {
            sqliteConnection.EnableExtensions(true);
            sqliteConnection.LoadExtension(_extensionPath, "sqlite3_vec_init");

            // 从数据库动态获取实际使用的 embedding 维度
            var dimensions = await DetectDimensionsAsync(sqliteConnection, cancellationToken);

            // 如果维度变化了或首次初始化，创建/重建 vec 表
            if (!s_initialized || s_cachedDimensions != dimensions)
            {
                s_cachedDimensions = dimensions;
                s_initialized = true;

                await using var dropCmd = sqliteConnection.CreateCommand();
                dropCmd.CommandText = "DROP TABLE IF EXISTS vec_note_embeddings; DROP TABLE IF EXISTS vec_chunk_embeddings;";
                await dropCmd.ExecuteNonQueryAsync(cancellationToken);

                await using var createCmd = sqliteConnection.CreateCommand();
                createCmd.CommandText = $@"
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_note_embeddings USING vec0(
                        note_id TEXT PRIMARY KEY,
                        embedding float[{dimensions}]
                    );
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunk_embeddings USING vec0(
                        chunk_id TEXT PRIMARY KEY,
                        embedding float[{dimensions}]
                    );";
                await createCmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        catch
        {
            // sqlite-vec 加载失败时不阻止正常使用，后续会回退到内存相似度
        }
        finally
        {
            s_initLock.Release();
        }
    }

    /// <summary>
    /// 从数据库中检测实际 embedding 维度：优先取 NoteEmbeddings 中最新记录，
    /// 其次取 AiModels 中标记为 Embedding 的模型，最后回退到配置值。
    /// </summary>
    private async Task<int> DetectDimensionsAsync(SqliteConnection conn, CancellationToken ct)
    {
        try
        {
            // 1. 从已有 embedding 记录中获取维度
            await using var cmd1 = conn.CreateCommand();
            cmd1.CommandText = "SELECT Dimensions FROM NoteEmbeddings ORDER BY UpdatedAt DESC LIMIT 1";
            var result = await cmd1.ExecuteScalarAsync(ct);
            if (result is int d1 && d1 > 0) return d1;

            // 2. 从 AiModels 表中获取 Embedding 类型模型的维度
            await using var cmd2 = conn.CreateCommand();
            cmd2.CommandText = "SELECT Dimensions FROM AiModels WHERE Purpose = 'embedding' AND Dimensions IS NOT NULL LIMIT 1";
            var result2 = await cmd2.ExecuteScalarAsync(ct);
            if (result2 is int d2 && d2 > 0) return d2;
        }
        catch
        {
            // 表可能不存在
        }

        return _fallbackDimensions;
    }
}
