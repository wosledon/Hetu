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

    /// <summary>按分块 ID 删除分块及其向量（用于增量重建索引时只清理失效分块）</summary>
    Task DeleteChunksByIdsAsync(IEnumerable<Guid> chunkIds, CancellationToken cancellationToken = default);

    // ── ChunkEmbedding 相关 ──
    Task<NoteChunkEmbedding?> GetChunkEmbeddingAsync(Guid chunkId, CancellationToken cancellationToken = default);
    Task AddChunkEmbeddingAsync(NoteChunkEmbedding embedding, CancellationToken cancellationToken = default);
    Task UpdateChunkEmbeddingAsync(NoteChunkEmbedding embedding, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<NoteChunkEmbedding>> GetAllChunkEmbeddingsAsync(CancellationToken cancellationToken = default);

    /// <summary>获取指定知识项下已有向量的分块 ID（不加载向量字节）</summary>
    Task<IReadOnlyList<Guid>> GetEmbeddedChunkIdsAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default);

    /// <summary>按类型统计知识项数量（数据库 GROUP BY，不加载实体）</summary>
    Task<Dictionary<KnowledgeItemType, int>> CountByTypeAsync(CancellationToken cancellationToken = default);

    /// <summary>统计已建立分块向量且知识项仍存在的条数（数据库 DISTINCT + EXISTS）</summary>
    Task<int> CountIndexedItemsAsync(CancellationToken cancellationToken = default);

    /// <summary>分块向量按知识项聚合（数据库 GROUP BY，只回传每个知识项一行摘要）</summary>
    Task<IReadOnlyList<ChunkEmbeddingSummary>> GetChunkEmbeddingSummariesAsync(CancellationToken cancellationToken = default);

    /// <summary>查询尚未建立分块向量的知识项（只取入队所需字段，可按类型筛选）</summary>
    Task<IReadOnlyList<UnindexedKnowledgeItem>> GetUnindexedAsync(KnowledgeItemType? type = null, CancellationToken cancellationToken = default);

    Task SyncChunkEmbeddingToVecTableAsync(Guid chunkId, float[] embedding, CancellationToken cancellationToken = default);
}
