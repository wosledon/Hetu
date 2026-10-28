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

    public Task<KnowledgeItem?> GetByWikiDocumentIdAsync(Guid wikiDocumentId, CancellationToken cancellationToken = default)
        => DbSet
            .AsNoTracking()
            .FirstOrDefaultAsync(k => k.WikiDocumentId == wikiDocumentId, cancellationToken);

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

    public async Task<IReadOnlyList<ChunkEmbeddingSummary>> GetChunkEmbeddingSummariesAsync(
        IReadOnlyCollection<Guid>? knowledgeItemIds = null,
        CancellationToken cancellationToken = default)
    {
        var source = Context.NoteChunkEmbeddings
            .AsNoTracking()
            // 只统计「仍然存在且未删除」的知识项，与 CountIndexedItemsAsync 口径一致
            .Where(e => e.Chunk.KnowledgeItem != null && !e.Chunk.KnowledgeItem.IsDeleted);

        // 分页列表只聚合当前页的知识项：不传则聚合全部
        if (knowledgeItemIds is { Count: > 0 })
        {
            var ids = knowledgeItemIds.ToList();
            source = source.Where(e => ids.Contains(e.Chunk.KnowledgeItemId));
        }
        else if (knowledgeItemIds is { Count: 0 })
        {
            return [];
        }

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

    public async Task<(int TotalChunks, int IndexedChunks)> CountChunksAsync(CancellationToken cancellationToken = default)
    {
        // 与 CountIndexedItemsAsync 口径一致：已删除知识项的分块/向量都不计入，覆盖率才是同一把尺子
        var total = await Context.NoteChunks
            .AsNoTracking()
            .Where(c => c.KnowledgeItem != null && !c.KnowledgeItem.IsDeleted)
            .CountAsync(cancellationToken);
        var indexed = await Context.NoteChunkEmbeddings
            .AsNoTracking()
            .Where(e => e.Chunk.KnowledgeItem != null && !e.Chunk.KnowledgeItem.IsDeleted)
            .CountAsync(cancellationToken);
        return (total, indexed);
    }

    public async Task<Dictionary<KnowledgeItemType, int>> CountIndexedByTypeAsync(CancellationToken cancellationToken = default)
    {
        // DISTINCT 在数据库完成（同一知识项多个分块只算一次），分组只是按固定的 4 种类型计数
        var pairs = await Context.NoteChunkEmbeddings
            .AsNoTracking()
            .Where(e => e.Chunk.KnowledgeItem != null && !e.Chunk.KnowledgeItem.IsDeleted)
            .Select(e => new { e.Chunk.KnowledgeItemId, e.Chunk.KnowledgeItem!.Type })
            .Distinct()
            .ToListAsync(cancellationToken);
        return pairs
            .GroupBy(p => p.Type)
            .ToDictionary(g => g.Key, g => g.Count());
    }

    public async Task<IReadOnlyList<RecentIndexedKnowledgeItem>> GetRecentIndexedAsync(int count, CancellationToken cancellationToken = default)
    {
        if (count <= 0) return [];

        var source = Context.NoteChunkEmbeddings
            .AsNoTracking()
            // 只统计「仍然存在且未删除」的知识项，与 CountIndexedItemsAsync 口径一致
            .Where(e => e.Chunk.KnowledgeItem != null && !e.Chunk.KnowledgeItem.IsDeleted);

        // 每个知识项一行：分块数 / 模型 / 最近向量更新时间
        var latest = new List<(Guid Id, int ChunkCount, string? Model, DateTimeOffset UpdatedAt)>();
        if (Context.Database.IsSqlite())
        {
            // SQLite 的 EF provider 不能在 SQL 里聚合 DateTimeOffset：
            // 计数/模型仍在 SQL 聚合，时间戳只投影两列后在内存取最大值，再按时间倒序取前 count 个
            var aggregates = await source
                .GroupBy(e => e.Chunk.KnowledgeItemId)
                .Select(g => new
                {
                    KnowledgeItemId = g.Key,
                    ChunkCount = g.Count(),
                    Model = g.Max(e => e.Model),
                })
                .ToListAsync(cancellationToken);

            var timestamps = await source
                .Select(e => new { e.Chunk.KnowledgeItemId, e.UpdatedAt })
                .ToListAsync(cancellationToken);

            var latestByItem = timestamps
                .GroupBy(t => t.KnowledgeItemId)
                .ToDictionary(g => g.Key, g => g.Max(t => t.UpdatedAt));

            latest = aggregates
                .Select(a => (a.KnowledgeItemId, a.ChunkCount, a.Model, latestByItem.GetValueOrDefault(a.KnowledgeItemId)))
                .OrderByDescending(x => x.Item4)
                .Take(count)
                .ToList();
        }
        else
        {
            var rows = await source
                .GroupBy(e => e.Chunk.KnowledgeItemId)
                .Select(g => new
                {
                    KnowledgeItemId = g.Key,
                    ChunkCount = g.Count(),
                    Model = g.Max(e => e.Model),
                    UpdatedAt = g.Max(e => e.UpdatedAt),
                })
                .OrderByDescending(x => x.UpdatedAt)
                .Take(count)
                .ToListAsync(cancellationToken);

            latest = rows.Select(r => (r.KnowledgeItemId, r.ChunkCount, r.Model, r.UpdatedAt)).ToList();
        }

        var ids = latest.Select(x => x.Id).ToList();
        if (ids.Count == 0) return [];

        // 标题/类型按主键回表（一次 IN 查询），顺序仍按上面的倒序结果
        var items = await Context.KnowledgeItems
            .AsNoTracking()
            .Where(k => ids.Contains(k.Id))
            .Select(k => new { k.Id, k.Type, k.Title })
            .ToListAsync(cancellationToken);
        var byId = items.ToDictionary(k => k.Id);

        return latest
            .Where(x => byId.ContainsKey(x.Id))
            .Select(x => new RecentIndexedKnowledgeItem
            {
                Id = x.Id,
                Type = byId[x.Id].Type,
                Title = byId[x.Id].Title,
                ChunkCount = x.ChunkCount,
                Model = x.Model,
                UpdatedAt = x.UpdatedAt,
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
