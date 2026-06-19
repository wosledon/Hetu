using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hetu.Infrastructure.PostgresMigrations.Data;

public class PostgresDesignTimeDbContextFactory : IDesignTimeDbContextFactory<HetuDbContext>
{
    public HetuDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<HetuDbContext>();
        optionsBuilder.UseNpgsql(
            "Host=localhost;Database=hetu;Username=postgres;Password=postgres",
            npgsql =>
            {
                npgsql.UseVector();
                npgsql.MigrationsAssembly(typeof(PostgresDesignTimeDbContextFactory).Assembly.GetName().Name!);
            });

        return new HetuDbContext(optionsBuilder.Options);
    }
}
