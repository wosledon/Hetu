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
            using var command = connection.CreateCommand();
            // 过度获取：vec0 的 k 限制在 JOIN/IsDeleted 过滤前生效，
            // 所以请求 3 倍数量以确保过滤后仍有足够结果
            var fetchK = topK * 3;
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

    private async Task<IReadOnlyList<NoteSearchResultDto>> SearchInMemoryAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken)
    {
        var allEmbeddings = await _unitOfWork.Notes.GetAllEmbeddingsAsync(cancellationToken);

        return allEmbeddings
            .Select(e => new
            {
                e.NoteId,
                e.Note.Title,
                e.Note.Content,
                e.Note.UpdatedAt,
                Similarity = CosineSimilarity(queryEmbedding, BytesToFloatArray(e.Embedding))
            })
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
