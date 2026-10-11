using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface INoteRepository : IRepository<Note>
{
    Task<Note?> GetByIdWithTagsAsync(Guid id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetListAsync(Guid? notebookId = null, Guid? tagId = null, bool includeDeleted = false, bool filterNoNotebook = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// 分页取笔记（数据库 OFFSET/FETCH + SQL COUNT），避免把全部笔记读进内存。
    /// 排序固定为「置顶优先，其次最近更新」，保证分页稳定。
    /// </summary>
    Task<(IReadOnlyList<Note> Items, int Total)> GetPagedAsync(
        Guid? notebookId, Guid? tagId, bool includeDeleted, bool filterNoNotebook,
        int skip, int take, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetByNotebookAsync(Guid notebookId, bool includeDeleted = false, CancellationToken cancellationToken = default);
    Task UnassignNotebookAsync(Guid notebookId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetByTagAsync(Guid tagId, bool includeDeleted = false, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> SearchAsync(string keyword, Guid? notebookId = null, Guid? tagId = null, bool includeDeleted = false, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetDeletedAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetOldDeletedAsync(DateTimeOffset cutoff, CancellationToken cancellationToken = default);
    Task SoftDeleteAsync(Note note, CancellationToken cancellationToken = default);
    Task RestoreAsync(Note note, CancellationToken cancellationToken = default);
    Task HardDeleteAsync(Note note, CancellationToken cancellationToken = default);
    Task SetTagsAsync(Guid noteId, IEnumerable<Guid> tagIds, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Guid>> GetNoteIdsByTagAsync(Guid tagId, CancellationToken cancellationToken = default);
    Task AddTagToNotesAsync(Guid tagId, IEnumerable<Guid> noteIds, CancellationToken cancellationToken = default);
    Task RemoveTagFromNotesAsync(Guid tagId, IEnumerable<Guid> noteIds, CancellationToken cancellationToken = default);
    Task<NoteEmbedding?> GetEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task AddEmbeddingAsync(NoteEmbedding embedding, CancellationToken cancellationToken = default);
    Task UpdateEmbeddingAsync(NoteEmbedding embedding, CancellationToken cancellationToken = default);
    Task DeleteEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<NoteEmbedding>> GetAllEmbeddingsAsync(CancellationToken cancellationToken = default);
    Task SyncEmbeddingToVecTableAsync(Guid noteId, float[] embedding, CancellationToken cancellationToken = default);
}
