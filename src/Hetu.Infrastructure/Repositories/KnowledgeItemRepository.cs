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
