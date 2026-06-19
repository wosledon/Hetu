namespace Hetu.Infrastructure.Data;

public sealed record DatabaseProviderInfo(string Provider, string ConnectionString)
{
    public bool IsPostgreSql => Provider is "postgresql" or "postgres";
    public bool IsSqlite => Provider is "sqlite";
}
