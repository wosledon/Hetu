using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class KnowledgeItemRepository : EfRepository<KnowledgeItem>, IKnowledgeItemRepository
{
    public KnowledgeItemRepository(HetuDbContext context) : base(context) { }

    public override Task<KnowledgeItem?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
        => DbSet
            .AsNoTracking()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(k => k.Id == id, cancellationToken);

    public async Task<IReadOnlyList<KnowledgeItem>> GetByTypeAsync(KnowledgeItemType type, CancellationToken cancellationToken = default)
    {
        var list = await DbSet
            .AsNoTracking()
            .Where(k => k.Type == type)
            .ToListAsync(cancellationToken);
        return list.OrderByDescending(k => k.UpdatedAt).ToList();
    }

    public Task<KnowledgeItem?> GetByNoteIdAsync(Guid noteId, CancellationToken cancellationToken = default)
        => DbSet
            .AsNoTracking()
            .FirstOrDefaultAsync(k => k.NoteId == noteId, cancellationToken);

    public Task<KnowledgeItem?> GetByIdWithChunksAsync(Guid id, CancellationToken cancellationToken = default)
        => DbSet
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Include(k => k.Chunks.OrderBy(c => c.ChunkIndex))
            .FirstOrDefaultAsync(k => k.Id == id, cancellationToken);

    public async Task<IReadOnlyList<NoteChunk>> GetChunksAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default)
    {
        return await Context.NoteChunks
            .AsNoTracking()
            .Where(c => c.KnowledgeItemId == knowledgeItemId)
            .OrderBy(c => c.ChunkIndex)
            .ToListAsync(cancellationToken);
    }

    public Task AddChunksAsync(IEnumerable<NoteChunk> chunks, CancellationToken cancellationToken = default)
    {
        Context.NoteChunks.AddRange(chunks);
        return Task.CompletedTask;
    }

    public async Task DeleteChunksAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default)
    {
        var chunks = await Context.NoteChunks
            .Where(c => c.KnowledgeItemId == knowledgeItemId)
            .ToListAsync(cancellationToken);

        if (chunks.Count > 0)
        {
            var chunkIds = chunks.Select(c => c.Id).ToList();
            var embeddings = await Context.NoteChunkEmbeddings
                .Where(e => chunkIds.Contains(e.ChunkId))
                .ToListAsync(cancellationToken);
            Context.NoteChunkEmbeddings.RemoveRange(embeddings);
            Context.NoteChunks.RemoveRange(chunks);
        }
    }

    public async Task DeleteChunksByIdsAsync(IEnumerable<Guid> chunkIds, CancellationToken cancellationToken = default)
    {
        var ids = chunkIds.Distinct().ToList();
        if (ids.Count == 0) return;

        var chunks = await Context.NoteChunks
            .Where(c => ids.Contains(c.Id))
            .ToListAsync(cancellationToken);

        if (chunks.Count == 0) return;

        var existingIds = chunks.Select(c => c.Id).ToList();
        var embeddings = await Context.NoteChunkEmbeddings
            .Where(e => existingIds.Contains(e.ChunkId))
            .ToListAsync(cancellationToken);

        Context.NoteChunkEmbeddings.RemoveRange(embeddings);
        Context.NoteChunks.RemoveRange(chunks);
    }

    public Task<NoteChunkEmbedding?> GetChunkEmbeddingAsync(Guid chunkId, CancellationToken cancellationToken = default)
        => Context.NoteChunkEmbeddings.AsNoTracking().FirstOrDefaultAsync(e => e.ChunkId == chunkId, cancellationToken);

    public Task AddChunkEmbeddingAsync(NoteChunkEmbedding embedding, CancellationToken cancellationToken = default)
    {
        Context.NoteChunkEmbeddings.Add(embedding);
        return Task.CompletedTask;
    }

    public Task UpdateChunkEmbeddingAsync(NoteChunkEmbedding embedding, CancellationToken cancellationToken = default)
    {
        Context.NoteChunkEmbeddings.Update(embedding);
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<NoteChunkEmbedding>> GetAllChunkEmbeddingsAsync(CancellationToken cancellationToken = default)
    {
        return await Context.NoteChunkEmbeddings
            .AsNoTracking()
            .Include(e => e.Chunk)
            .ThenInclude(c => c.KnowledgeItem)
            .ToListAsync(cancellationToken);
    }

    public async Task<Dictionary<KnowledgeItemType, int>> CountByTypeAsync(CancellationToken cancellationToken = default)
        => await Context.KnowledgeItems
            .AsNoTracking()
            .GroupBy(k => k.Type)
            .Select(g => new { Type = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Type, x => x.Count, cancellationToken);

    public async Task<int> CountIndexedItemsAsync(CancellationToken cancellationToken = default)
        => await Context.NoteChunkEmbeddings
            .AsNoTracking()
            // 只统计「仍然存在且未删除」的知识项：笔记移入回收站只软删 KnowledgeItem
            // （分块与向量保留，便于恢复后仍是已索引），不过滤会出现 未索引 = -2、覆盖率 200% 这类结果
            .Where(e => e.Chunk.KnowledgeItem != null && !e.Chunk.KnowledgeItem.IsDeleted)
            .Select(e => e.Chunk.KnowledgeItemId)
            .Distinct()
            .CountAsync(cancellationToken);

    public async Task<IReadOnlyList<ChunkEmbeddingSummary>> GetChunkEmbeddingSummariesAsync(CancellationToken cancellationToken = default)
    {
        var source = Context.NoteChunkEmbeddings
            .AsNoTracking()
            // 只统计「仍然存在且未删除」的知识项，与 CountIndexedItemsAsync 口径一致
            .Where(e => e.Chunk.KnowledgeItem != null && !e.Chunk.KnowledgeItem.IsDeleted);

        if (!Context.Database.IsSqlite())
        {
            // 聚合在数据库完成：每个知识项一行（分块数 / 模型 / 维度 / 最近更新时间），不再逐块加载
            return await source
                .GroupBy(e => e.Chunk.KnowledgeItemId)
                .Select(g => new ChunkEmbeddingSummary
                {
                    KnowledgeItemId = g.Key,
                    ChunkCount = g.Count(),
                    Model = g.Max(e => e.Model),
                    Dimensions = g.Max(e => e.Dimensions),
                    UpdatedAt = g.Max(e => e.UpdatedAt),
                })
                .ToListAsync(cancellationToken);
        }

        // SQLite 的 EF provider 不支持聚合 DateTimeOffset：
        // 计数/模型/维度仍在 SQL 聚合，最近更新时间只投影两列（不加载向量）后在内存取最大值。
        var aggregates = await source
            .GroupBy(e => e.Chunk.KnowledgeItemId)
            .Select(g => new
            {
                KnowledgeItemId = g.Key,
                ChunkCount = g.Count(),
                Model = g.Max(e => e.Model),
                Dimensions = g.Max(e => e.Dimensions),
            })
            .ToListAsync(cancellationToken);

        var timestamps = await source
            .Select(e => new { e.Chunk.KnowledgeItemId, e.UpdatedAt })
            .ToListAsync(cancellationToken);

        var latestByItem = timestamps
            .GroupBy(t => t.KnowledgeItemId)
            .ToDictionary(g => g.Key, g => g.Max(t => t.UpdatedAt));

        return aggregates
            .Select(a => new ChunkEmbeddingSummary
            {
                KnowledgeItemId = a.KnowledgeItemId,
                ChunkCount = a.ChunkCount,
                Model = a.Model,
                Dimensions = a.Dimensions,
                UpdatedAt = latestByItem.GetValueOrDefault(a.KnowledgeItemId),
            })
            .ToList();
    }

    public async Task<IReadOnlyList<UnindexedKnowledgeItem>> GetUnindexedAsync(KnowledgeItemType? type = null, CancellationToken cancellationToken = default)
    {
        var query = Context.KnowledgeItems
            .AsNoTracking()
            .Where(k => !Context.NoteChunkEmbeddings.Any(e => e.Chunk.KnowledgeItemId == k.Id));

        if (type.HasValue)
            query = query.Where(k => k.Type == type.Value);

        return await query
            .Select(k => new UnindexedKnowledgeItem
            {
                Id = k.Id,
                Type = k.Type,
                NoteId = k.NoteId,
                Title = k.Title,
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Guid>> GetEmbeddedChunkIdsAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default)
    {
        return await Context.NoteChunkEmbeddings
            .AsNoTracking()
            .Where(e => e.Chunk.KnowledgeItemId == knowledgeItemId)
            .Select(e => e.ChunkId)
            .ToListAsync(cancellationToken);
    }

    public async Task SyncChunkEmbeddingToVecTableAsync(Guid chunkId, float[] embedding, CancellationToken cancellationToken = default)
    {
        if (!Context.Database.IsSqlite()) return;

        try
        {
            var connection = Context.Database.GetDbConnection();
            if (connection.State != System.Data.ConnectionState.Open)
                await connection.OpenAsync(cancellationToken);

            await using var command = connection.CreateCommand();
            var vectorText = $"[{string.Join(",", embedding)}]";
            command.CommandText = $"INSERT OR REPLACE INTO vec_chunk_embeddings (chunk_id, embedding) VALUES ('{chunkId}', '{vectorText}')";
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch
        {
            // sqlite-vec 虚拟表未就绪时忽略
        }
    }
}
