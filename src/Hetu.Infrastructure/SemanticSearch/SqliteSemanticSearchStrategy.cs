using System.Data;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Hetu.Shared.Notes;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.SemanticSearch;

public class SqliteSemanticSearchStrategy : ISemanticSearchStrategy
{
    private readonly HetuDbContext _context;
    private readonly IUnitOfWork _unitOfWork;

    public SqliteSemanticSearchStrategy(HetuDbContext context, IUnitOfWork unitOfWork)
    {
        _context = context;
        _unitOfWork = unitOfWork;
    }

    public async Task<IReadOnlyList<NoteSearchResultDto>> SearchAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken = default)
    {
        if (_context.Database.IsSqlite())
        {
            try
            {
                var vecResults = await SearchWithVecAsync(queryEmbedding, topK, cancellationToken);
                if (vecResults.Count > 0) return vecResults;
            }
            catch
            {
                // sqlite-vec 不可用，回退到内存计算
            }
        }

        return await SearchInMemoryAsync(queryEmbedding, topK, cancellationToken);
    }

    private async Task<IReadOnlyList<NoteSearchResultDto>> SearchWithVecAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken)
    {
        var connection = _context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        try
        {
            var fetchK = topK * 3;
            var results = new List<NoteSearchResultDto>();

            // 1. 搜索整篇笔记 embedding
            using (var command = connection.CreateCommand())
            {
                command.CommandText = @"
                    SELECT n.""Id"", n.""Title"", n.""Content"", n.""UpdatedAt""
                    FROM vec_note_embeddings v
                    JOIN ""Notes"" n ON n.""Id"" = v.note_id
                    WHERE v.embedding MATCH @query AND k = @fetchK AND n.""IsDeleted"" = false
                    ORDER BY distance
                    LIMIT @topK";
                command.Parameters.Add(new SqliteParameter("query", $"[{string.Join(",", queryEmbedding)}]"));
                command.Parameters.Add(new SqliteParameter("fetchK", fetchK));
                command.Parameters.Add(new SqliteParameter("topK", topK));

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

            // 2. 搜索 chunk embedding（如果 vec_chunk_embeddings 表存在）
            if (results.Count < topK)
            {
                try
                {
                    using var chunkCmd = connection.CreateCommand();
                    chunkCmd.CommandText = @"
                        SELECT n.""Id"", n.""Title"", c.""Content"", c.""Summary"", n.""UpdatedAt""
                        FROM vec_chunk_embeddings v
                        JOIN ""NoteChunks"" c ON c.""Id"" = v.chunk_id
                        JOIN ""Notes"" n ON n.""Id"" = c.""NoteId""
                        WHERE v.embedding MATCH @query AND k = @fetchK AND n.""IsDeleted"" = false
                        ORDER BY distance
                        LIMIT @limitK";
                    chunkCmd.Parameters.Add(new SqliteParameter("query", $"[{string.Join(",", queryEmbedding)}]"));
                    chunkCmd.Parameters.Add(new SqliteParameter("fetchK", fetchK));
                    chunkCmd.Parameters.Add(new SqliteParameter("limitK", topK - results.Count));

                    var existingIds = results.Select(r => r.Id).ToHashSet();
                    using var chunkReader = await chunkCmd.ExecuteReaderAsync(cancellationToken);
                    while (await chunkReader.ReadAsync(cancellationToken))
                    {
                        var noteId = chunkReader.GetGuid(0);
                        if (existingIds.Contains(noteId)) continue;

                        var content = chunkReader.IsDBNull(2) ? "" : chunkReader.GetString(2);
                        var summary = chunkReader.IsDBNull(3) ? null : chunkReader.GetString(3);
                        var snippet = !string.IsNullOrWhiteSpace(summary) ? summary : MakeSnippet(content);

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
                    // vec_chunk_embeddings 表不存在时忽略
                }
            }

            return results.Take(topK).ToList();
        }
        finally
        {
            await connection.CloseAsync();
        }
    }

    private async Task<IReadOnlyList<NoteSearchResultDto>> SearchInMemoryAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken)
    {
        var results = new List<(Guid NoteId, string Title, string Content, DateTimeOffset UpdatedAt, float Similarity)>();

        // 1. 整篇笔记 embedding
        var allEmbeddings = await _unitOfWork.Notes.GetAllEmbeddingsAsync(cancellationToken);
        results.AddRange(allEmbeddings.Select(e => (
            e.NoteId,
            e.Note.Title,
            e.Note.Content,
            e.Note.UpdatedAt,
            Similarity: CosineSimilarity(queryEmbedding, BytesToFloatArray(e.Embedding))
        )));

        // 2. Chunk embedding
        try
        {
            var allChunkEmbeddings = await _unitOfWork.Notes.GetAllChunkEmbeddingsAsync(cancellationToken);
            results.AddRange(allChunkEmbeddings.Select(ce => (
                ce.Chunk.NoteId,
                ce.Chunk.Note.Title,
                !string.IsNullOrWhiteSpace(ce.Chunk.Summary) ? ce.Chunk.Summary : ce.Chunk.Content,
                ce.Chunk.Note.UpdatedAt,
                Similarity: CosineSimilarity(queryEmbedding, BytesToFloatArray(ce.Embedding))
            )));
        }
        catch
        {
            // chunk 表可能不存在
        }

        return results
            .GroupBy(r => r.NoteId)
            .Select(g => g.OrderByDescending(r => r.Similarity).First())
            .OrderByDescending(x => x.Similarity)
            .Take(topK)
            .Select(x => new NoteSearchResultDto
            {
                Id = x.NoteId,
                Title = x.Title,
                ContentSnippet = MakeSnippet(x.Content),
                UpdatedAt = x.UpdatedAt
            })
            .ToList();
    }

    private static float CosineSimilarity(float[] a, float[] b)
    {
        if (a.Length != b.Length) return 0;
        float dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.Length; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA == 0 || normB == 0) return 0;
        return dot / (float)(Math.Sqrt(normA) * Math.Sqrt(normB));
    }

    private static float[] BytesToFloatArray(byte[] bytes)
    {
        var floats = new float[bytes.Length / 4];
        for (int i = 0; i < floats.Length; i++)
        {
            floats[i] = BitConverter.ToSingle(bytes, i * 4);
        }
        return floats;
    }

    private static string? MakeSnippet(string content)
    {
        if (string.IsNullOrWhiteSpace(content)) return null;
        return content.Length > 120 ? content[..120] + "..." : content;
    }
}
