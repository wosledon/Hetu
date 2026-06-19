using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface INoteRepository : IRepository<Note>
{
    Task<Note?> GetByIdWithTagsAsync(Guid id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetListAsync(Guid? notebookId = null, Guid? tagId = null, bool includeDeleted = false, CancellationToken cancellationToken = default);
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
    Task<IReadOnlyList<NoteEmbedding>> GetAllEmbeddingsAsync(CancellationToken cancellationToken = default);
    Task SyncEmbeddingToVecTableAsync(Guid noteId, float[] embedding, CancellationToken cancellationToken = default);
}
