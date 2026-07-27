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
            var fetchK = topK * 3;
            var allResults = new List<(Guid Id, string Title, string ContentSnippet, DateTimeOffset UpdatedAt)>();

            // 1. 整篇笔记 embedding
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
                command.Parameters.Add(new NpgsqlParameter("topK", fetchK));

                using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var content = reader.GetString(2);
                    allResults.Add((
                        reader.GetGuid(0),
                        reader.GetString(1),
                        content.Length > 120 ? content[..120] + "..." : content,
                        reader.GetFieldValue<DateTimeOffset>(3)
                    ));
                }
            }
            catch
            {
                // NoteEmbeddings 不可用时忽略
            }

            // 2. Chunk embedding（包括笔记分块 + 网址/文件类型知识项）
            try
            {
                using var chunkCmd = connection.CreateCommand();
                chunkCmd.CommandText = @"
                    SELECT ki.""Id"", ki.""Title"", c.""Content"", c.""Summary"", ki.""UpdatedAt""
                    FROM ""NoteChunkEmbeddings"" nce
                    JOIN ""NoteChunks"" c ON c.""Id"" = nce.""ChunkId""
                    JOIN ""KnowledgeItems"" ki ON ki.""Id"" = c.""KnowledgeItemId""
                    WHERE ki.""IsDeleted"" = false
                    ORDER BY nce.""Vector"" <=> @query
                    LIMIT @limitK";
                chunkCmd.Parameters.Add(new NpgsqlParameter("query", new Vector(queryEmbedding)));
                chunkCmd.Parameters.Add(new NpgsqlParameter("limitK", fetchK));

                using var chunkReader = await chunkCmd.ExecuteReaderAsync(cancellationToken);
                while (await chunkReader.ReadAsync(cancellationToken))
                {
                    var content = chunkReader.IsDBNull(2) ? "" : chunkReader.GetString(2);
                    var summary = chunkReader.IsDBNull(3) ? null : chunkReader.GetString(3);
                    var snippet = !string.IsNullOrWhiteSpace(summary) ? summary : (content.Length > 120 ? content[..120] + "..." : content);

                    allResults.Add((
                        chunkReader.GetGuid(0),
                        chunkReader.GetString(1),
                        snippet,
                        chunkReader.GetFieldValue<DateTimeOffset>(4)
                    ));
                }
            }
            catch
            {
                // NoteChunkEmbeddings 表不存在时忽略
            }

            // 3. 按 ID 去重，取每个知识项的最优匹配
            var seen = new HashSet<Guid>();
            var merged = new List<NoteSearchResultDto>();
            foreach (var (id, title, snippet, updatedAt) in allResults)
            {
                if (seen.Add(id))
                {
                    merged.Add(new NoteSearchResultDto
                    {
                        Id = id,
                        Title = title,
                        ContentSnippet = snippet,
                        UpdatedAt = updatedAt
                    });
                }
            }

            return merged.Take(topK).ToList();
        }
        finally
        {
            await connection.CloseAsync();
        }
    }
}
