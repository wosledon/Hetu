using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 项目代码索引的向量存储：把分块向量下沉到数据库做近似最近邻检索
/// （SQLite 走 sqlite-vec 虚表、PostgreSQL 走 pgvector），避免每次检索把整个索引读进内存。
/// 任一实现不可用时 <see cref="SearchAsync"/> 返回 null，由调用方回退到内存余弦计算。
/// </summary>
public interface IWorkCodeVectorStore
{
    /// <summary>写入或更新分块向量（未提供数据库侧向量检索时为空实现）</summary>
    Task UpsertAsync(IReadOnlyList<WorkCodeChunk> chunks, CancellationToken cancellationToken = default);

    /// <summary>删除分块向量（未提供数据库侧向量检索时为空实现）</summary>
    Task DeleteAsync(IReadOnlyList<Guid> chunkIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// 按向量相似度取出候选分块 Id（按距离升序）。
    /// 返回 null 表示当前环境不支持数据库侧检索；返回空列表表示索引为空。
    /// </summary>
    Task<IReadOnlyList<Guid>?> SearchAsync(Guid projectId, float[] queryVector, int topK, CancellationToken cancellationToken = default);

    /// <summary>数据库侧索引中的分块数量；不可用时返回 -1</summary>
    Task<int> CountAsync(Guid projectId, CancellationToken cancellationToken = default);
}
