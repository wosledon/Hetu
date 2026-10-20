using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface INoteRepository : IRepository<Note>
{
    Task<Note?> GetByIdWithTagsAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>批量取直接子笔记数量（仅未删除），供列表/树判断是否可展开</summary>
    Task<Dictionary<Guid, int>> GetChildCountsAsync(IReadOnlyCollection<Guid> parentIds, CancellationToken cancellationToken = default);

    /// <summary>按父级/标签/回收站过滤取笔记（含标签，内存排序）</summary>
    Task<IReadOnlyList<Note>> GetListAsync(Guid? parentId = null, bool filterRoot = false, Guid? tagId = null, bool includeDeleted = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// 分页取笔记（数据库 OFFSET/FETCH + SQL COUNT），避免把全部笔记读进内存。
    /// 排序固定为「置顶优先，其次最近更新」，保证分页稳定。
    /// </summary>
    Task<(IReadOnlyList<Note> Items, int Total)> GetPagedAsync(
        Guid? parentId, bool filterRoot, Guid? tagId, bool includeDeleted,
        int skip, int take, CancellationToken cancellationToken = default);

    /// <summary>取直接子笔记（嵌套笔记树按需展开）</summary>
    Task<IReadOnlyList<Note>> GetChildrenAsync(Guid parentId, bool includeDeleted = false, CancellationToken cancellationToken = default);

    /// <summary>取某笔记的全部后代（含多级），用于删除/移动时的级联处理</summary>
    Task<IReadOnlyList<Note>> GetDescendantsAsync(Guid id, bool includeDeleted = false, CancellationToken cancellationToken = default);

    /// <summary>根级笔记（ParentId 为空）</summary>
    Task<IReadOnlyList<Note>> GetRootNotesAsync(bool includeDeleted = false, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Note>> GetByTagAsync(Guid tagId, bool includeDeleted = false, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> SearchAsync(string keyword, Guid? tagId = null, bool includeDeleted = false, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetDeletedAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetOldDeletedAsync(DateTimeOffset cutoff, CancellationToken cancellationToken = default);
    Task SoftDeleteAsync(Note note, CancellationToken cancellationToken = default);
    Task RestoreAsync(Note note, CancellationToken cancellationToken = default);
    Task HardDeleteAsync(Note note, CancellationToken cancellationToken = default);
    Task SetTagsAsync(Guid noteId, IEnumerable<Guid> tagIds, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Guid>> GetNoteIdsByTagAsync(Guid tagId, CancellationToken cancellationToken = default);
    Task<IReadOnlyDictionary<Guid, List<Guid>>> GetNoteIdsByTagsAsync(IEnumerable<Guid> tagIds, CancellationToken cancellationToken = default);
    Task AddTagToNotesAsync(Guid tagId, IEnumerable<Guid> noteIds, CancellationToken cancellationToken = default);
    Task RemoveTagFromNotesAsync(Guid tagId, IEnumerable<Guid> noteIds, CancellationToken cancellationToken = default);
    Task<NoteEmbedding?> GetEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task AddEmbeddingAsync(NoteEmbedding embedding, CancellationToken cancellationToken = default);
    Task UpdateEmbeddingAsync(NoteEmbedding embedding, CancellationToken cancellationToken = default);
    Task DeleteEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<NoteEmbedding>> GetAllEmbeddingsAsync(CancellationToken cancellationToken = default);
    Task SyncEmbeddingToVecTableAsync(Guid noteId, float[] embedding, CancellationToken cancellationToken = default);
}
