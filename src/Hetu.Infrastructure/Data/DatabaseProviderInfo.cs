namespace Hetu.Infrastructure.Data;

/// <summary>
/// 当前生效的数据库提供程序与连接字符串，供导出、健康检查等需要感知底层存储的场景使用。
/// </summary>
public sealed record DatabaseProviderInfo(string Provider, string ConnectionString)
{
    public const string Sqlite = "sqlite";
    public const string PostgreSql = "postgresql";

    private const string PostgreSqlAlias = "postgres";

    public bool IsPostgreSql => IsPostgreSqlName(Provider);
    public bool IsSqlite => string.Equals(Provider, Sqlite, StringComparison.OrdinalIgnoreCase);

    /// <summary>归一化配置中的 provider 名称，把 <c>postgres</c> 别名统一成 <c>postgresql</c>。</summary>
    public static string Normalize(string? provider) => IsPostgreSqlName(provider) ? PostgreSql : Sqlite;

    public static bool IsPostgreSqlName(string? provider) =>
        string.Equals(provider, PostgreSql, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(provider, PostgreSqlAlias, StringComparison.OrdinalIgnoreCase);
}
