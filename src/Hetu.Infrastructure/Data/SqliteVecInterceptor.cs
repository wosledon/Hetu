using System.Data.Common;
using System.Threading;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;

namespace Hetu.Infrastructure.Data;

public class SqliteVecInterceptor : DbConnectionInterceptor
{
    private static readonly SemaphoreSlim s_initLock = new(1, 1);

    private readonly string _extensionPath;
    private readonly int _dimensions;

    public SqliteVecInterceptor(IConfiguration configuration)
    {
        var configuredPath = configuration["Sqlite:VecExtensionPath"];
        _extensionPath = !string.IsNullOrWhiteSpace(configuredPath)
            ? configuredPath
            : Path.Combine(AppContext.BaseDirectory, "sqlite-vec", "vec0.dll");
        _dimensions = configuration.GetValue<int?>("Embedding:Dimensions") ?? 1536;
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

            await using var command = sqliteConnection.CreateCommand();
            command.CommandText = $@"
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_note_embeddings USING vec0(
                    note_id TEXT PRIMARY KEY,
                    embedding float[{_dimensions}]
                );";
            await command.ExecuteNonQueryAsync(cancellationToken);
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
}
