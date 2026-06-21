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
            var results = new List<NoteSearchResultDto>();

            // 1. 整篇笔记 embedding
            using (var command = connection.CreateCommand())
            {
                command.CommandText = @"
                    SELECT n.""Id"", n.""Title"", n.""Content"", n.""UpdatedAt""
                    FROM ""NoteEmbeddings"" ne
                    JOIN ""Notes"" n ON n.""Id"" = ne.""NoteId""
                    WHERE n.""IsDeleted"" = false
                    ORDER BY ne.""Vector"" <=> @query
                    LIMIT @topK";
                command.Parameters.Add(new NpgsqlParameter("query", new Vector(queryEmbedding)));
                command.Parameters.Add(new NpgsqlParameter("topK", topK));

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
            }

            // 2. Chunk embedding
            if (results.Count < topK)
            {
                try
                {
                    using var chunkCmd = connection.CreateCommand();
                    chunkCmd.CommandText = @"
                        SELECT n.""Id"", n.""Title"", c.""Content"", c.""Summary"", n.""UpdatedAt""
                        FROM ""NoteChunkEmbeddings"" nce
                        JOIN ""NoteChunks"" c ON c.""Id"" = nce.""ChunkId""
                        JOIN ""Notes"" n ON n.""Id"" = c.""NoteId""
                        WHERE n.""IsDeleted"" = false
                        ORDER BY nce.""Vector"" <=> @query
                        LIMIT @limitK";
                    chunkCmd.Parameters.Add(new NpgsqlParameter("query", new Vector(queryEmbedding)));
                    chunkCmd.Parameters.Add(new NpgsqlParameter("limitK", topK - results.Count));

                    var existingIds = results.Select(r => r.Id).ToHashSet();
                    using var chunkReader = await chunkCmd.ExecuteReaderAsync(cancellationToken);
                    while (await chunkReader.ReadAsync(cancellationToken))
                    {
                        var noteId = chunkReader.GetGuid(0);
                        if (existingIds.Contains(noteId)) continue;

                        var content = chunkReader.IsDBNull(2) ? "" : chunkReader.GetString(2);
                        var summary = chunkReader.IsDBNull(3) ? null : chunkReader.GetString(3);
                        var snippet = !string.IsNullOrWhiteSpace(summary) ? summary : (content.Length > 120 ? content[..120] + "..." : content);

                        results.Add(new NoteSearchResultDto
                        {
                            Id = noteId,
                            Title = chunkReader.GetString(1),
                            ContentSnippet = snippet,
                            UpdatedAt = chunkReader.GetFieldValue<DateTimeOffset>(4)
                        });
                        existingIds.Add(noteId);
                    }
                }
                catch
                {
                    // NoteChunkEmbeddings 表不存在时忽略
                }
            }

            return results.Take(topK).ToList();
        }
        finally
        {
            await connection.CloseAsync();
        }
    }
}
