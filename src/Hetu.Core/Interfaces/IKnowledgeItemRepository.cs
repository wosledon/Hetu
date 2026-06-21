using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface IKnowledgeItemRepository : IRepository<KnowledgeItem>
{
    /// <summary>按类型筛选知识项</summary>
    Task<IReadOnlyList<KnowledgeItem>> GetByTypeAsync(KnowledgeItemType type, CancellationToken cancellationToken = default);

    /// <summary>通过关联笔记 ID 获取知识项</summary>
    Task<KnowledgeItem?> GetByNoteIdAsync(Guid noteId, CancellationToken cancellationToken = default);

    /// <summary>获取包含分块的知识项</summary>
    Task<KnowledgeItem?> GetByIdWithChunksAsync(Guid id, CancellationToken cancellationToken = default);

    // ── Chunk 相关 ──
    Task<IReadOnlyList<NoteChunk>> GetChunksAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default);
    Task AddChunksAsync(IEnumerable<NoteChunk> chunks, CancellationToken cancellationToken = default);
    Task DeleteChunksAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default);

    // ── ChunkEmbedding 相关 ──
    Task<NoteChunkEmbedding?> GetChunkEmbeddingAsync(Guid chunkId, CancellationToken cancellationToken = default);
    Task AddChunkEmbeddingAsync(NoteChunkEmbedding embedding, CancellationToken cancellationToken = default);
    Task UpdateChunkEmbeddingAsync(NoteChunkEmbedding embedding, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<NoteChunkEmbedding>> GetAllChunkEmbeddingsAsync(CancellationToken cancellationToken = default);
    Task SyncChunkEmbeddingToVecTableAsync(Guid chunkId, float[] embedding, CancellationToken cancellationToken = default);
}
