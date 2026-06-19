using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Hetu.Shared.Notes;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Pgvector;

namespace Hetu.Infrastructure.SemanticSearch;

public class PostgresSemanticSearchStrategy : ISemanticSearchStrategy
{
    private readonly HetuDbContext _context;

    public PostgresSemanticSearchStrategy(HetuDbContext context)
    {
        _context = context;
    }

    public async Task<IReadOnlyList<NoteSearchResultDto>> SearchAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken = default)
    {
        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        try
        {
            using var command = connection.CreateCommand();
            command.CommandText = @"
                SELECT n.""Id"", n.""Title"", n.""Content"", n.""UpdatedAt""
                FROM ""NoteEmbeddings"" ne
                JOIN ""Notes"" n ON n.""Id"" = ne.""NoteId""
                WHERE n.""IsDeleted"" = false
                ORDER BY ne.""Vector"" <=> @query
                LIMIT @topK";
            command.Parameters.Add(new NpgsqlParameter("query", new Vector(queryEmbedding)));
            command.Parameters.Add(new NpgsqlParameter("topK", topK));

            var results = new List<NoteSearchResultDto>();
            using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var content = reader.GetString(2);
                results.Add(new NoteSearchResultDto
                {
                    Id = reader.GetGuid(0),
                    Title = reader.GetString(1),
                    ContentSnippet = content.Length > 120 ? content[..120] + "..." : content,
                    UpdatedAt = reader.GetFieldValue<DateTimeOffset>(3)
                });
            }

            return results;
        }
        finally
        {
            await connection.CloseAsync();
        }
    }
}
