using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class NoteRepository : EfRepository<Note>, INoteRepository
{
    public NoteRepository(HetuDbContext context) : base(context) { }

    public override Task<Note?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
        => DbSet
            .AsNoTracking()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(n => n.Id == id, cancellationToken);

    public Task<Note?> GetByIdWithTagsAsync(Guid id, CancellationToken cancellationToken = default)
        => DbSet
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Include(n => n.NoteTags)
            .ThenInclude(nt => nt.Tag)
            .FirstOrDefaultAsync(n => n.Id == id, cancellationToken);

    public async Task<IReadOnlyList<Note>> GetListAsync(Guid? notebookId = null, Guid? tagId = null, bool includeDeleted = false, CancellationToken cancellationToken = default)
    {
        var query = DbSet.AsNoTracking();
        if (includeDeleted) query = query.IgnoreQueryFilters();

        query = query.Where(n => includeDeleted || !n.IsDeleted);

        if (notebookId.HasValue)
            query = query.Where(n => n.NotebookId == notebookId.Value);

        if (tagId.HasValue)
            query = query.Where(n => n.NoteTags.Any(nt => nt.TagId == tagId.Value));

        var notes = await query
            .Include(n => n.NoteTags)
            .ThenInclude(nt => nt.Tag)
            .ToListAsync(cancellationToken);

        return notes
            .OrderByDescending(n => n.IsPinned)
            .ThenByDescending(n => n.UpdatedAt)
            .ToList();
    }

    public async Task<IReadOnlyList<Note>> GetByNotebookAsync(Guid notebookId, bool includeDeleted = false, CancellationToken cancellationToken = default)
    {
        var query = DbSet.AsNoTracking();
        if (includeDeleted) query = query.IgnoreQueryFilters();
        var notes = await query
            .Include(n => n.NoteTags)
            .ThenInclude(nt => nt.Tag)
            .Where(n => n.NotebookId == notebookId)
            .ToListAsync(cancellationToken);

        return notes
            .OrderByDescending(n => n.IsPinned)
            .ThenByDescending(n => n.UpdatedAt)
            .ToList();
    }

    public async Task<IReadOnlyList<Note>> GetByTagAsync(Guid tagId, bool includeDeleted = false, CancellationToken cancellationToken = default)
    {
        var query = DbSet.AsNoTracking();
        if (includeDeleted) query = query.IgnoreQueryFilters();
        var notes = await query
            .Include(n => n.NoteTags)
            .ThenInclude(nt => nt.Tag)
            .Where(n => n.NoteTags.Any(nt => nt.TagId == tagId))
            .ToListAsync(cancellationToken);

        return notes
            .OrderByDescending(n => n.IsPinned)
            .ThenByDescending(n => n.UpdatedAt)
            .ToList();
    }

    public async Task<IReadOnlyList<Note>> SearchAsync(string keyword, Guid? notebookId = null, Guid? tagId = null, bool includeDeleted = false, CancellationToken cancellationToken = default)
    {
        var query = DbSet.AsNoTracking();
        if (includeDeleted) query = query.IgnoreQueryFilters();

        var lowerKeyword = keyword.ToLowerInvariant();
        query = query.Where(n => n.Title.ToLower().Contains(lowerKeyword) || n.Content.ToLower().Contains(lowerKeyword));

        if (notebookId.HasValue)
            query = query.Where(n => n.NotebookId == notebookId.Value);

        if (tagId.HasValue)
            query = query.Where(n => n.NoteTags.Any(nt => nt.TagId == tagId.Value));

        var notes = await query.ToListAsync(cancellationToken);
        return notes.OrderByDescending(n => n.UpdatedAt).ToList();
    }

    public async Task<IReadOnlyList<Note>> GetDeletedAsync(CancellationToken cancellationToken = default)
    {
        var notes = await DbSet.AsNoTracking()
            .IgnoreQueryFilters()
            .Where(n => n.IsDeleted)
            .ToListAsync(cancellationToken);

        return notes.OrderByDescending(n => n.DeletedAt).ToList();
    }

    public async Task<IReadOnlyList<Note>> GetOldDeletedAsync(DateTimeOffset cutoff, CancellationToken cancellationToken = default)
    {
        var notes = await DbSet.AsNoTracking()
            .IgnoreQueryFilters()
            .Where(n => n.IsDeleted)
            .ToListAsync(cancellationToken);

        return notes.Where(n => n.DeletedAt.HasValue && n.DeletedAt.Value < cutoff).ToList();
    }

    public Task SoftDeleteAsync(Note note, CancellationToken cancellationToken = default)
    {
        note.IsDeleted = true;
        note.DeletedAt = DateTimeOffset.UtcNow;
        note.UpdatedAt = DateTimeOffset.UtcNow;
        DbSet.Update(note);
        return Task.CompletedTask;
    }

    public Task RestoreAsync(Note note, CancellationToken cancellationToken = default)
    {
        note.IsDeleted = false;
        note.DeletedAt = null;
        note.UpdatedAt = DateTimeOffset.UtcNow;
        DbSet.Update(note);
        return Task.CompletedTask;
    }

    public Task HardDeleteAsync(Note note, CancellationToken cancellationToken = default)
    {
        DbSet.Remove(note);
        return Task.CompletedTask;
    }

    public async Task SetTagsAsync(Guid noteId, IEnumerable<Guid> tagIds, CancellationToken cancellationToken = default)
    {
        var existing = await Context.NoteTags.Where(nt => nt.NoteId == noteId).ToListAsync(cancellationToken);
        Context.NoteTags.RemoveRange(existing);

        var uniqueTagIds = tagIds.Distinct();
        foreach (var tagId in uniqueTagIds)
        {
            Context.NoteTags.Add(new NoteTag { NoteId = noteId, TagId = tagId });
        }
    }

    public async Task<IReadOnlyList<Guid>> GetNoteIdsByTagAsync(Guid tagId, CancellationToken cancellationToken = default)
    {
        var ids = await Context.NoteTags
            .AsNoTracking()
            .Where(nt => nt.TagId == tagId)
            .Select(nt => nt.NoteId)
            .ToListAsync(cancellationToken);
        return ids;
    }

    public async Task AddTagToNotesAsync(Guid tagId, IEnumerable<Guid> noteIds, CancellationToken cancellationToken = default)
    {
        var existing = await Context.NoteTags
            .AsNoTracking()
            .Where(nt => nt.TagId == tagId && noteIds.Contains(nt.NoteId))
            .Select(nt => nt.NoteId)
            .ToListAsync(cancellationToken);

        var toAdd = noteIds.Except(existing).ToList();
        foreach (var noteId in toAdd)
        {
            Context.NoteTags.Add(new NoteTag { NoteId = noteId, TagId = tagId });
        }
    }

    public async Task RemoveTagFromNotesAsync(Guid tagId, IEnumerable<Guid> noteIds, CancellationToken cancellationToken = default)
    {
        var existing = await Context.NoteTags
            .Where(nt => nt.TagId == tagId && noteIds.Contains(nt.NoteId))
            .ToListAsync(cancellationToken);
        Context.NoteTags.RemoveRange(existing);
    }

    public Task<NoteEmbedding?> GetEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default)
        => Context.NoteEmbeddings.AsNoTracking().FirstOrDefaultAsync(e => e.NoteId == noteId, cancellationToken);

    public Task AddEmbeddingAsync(NoteEmbedding embedding, CancellationToken cancellationToken = default)
    {
        Context.NoteEmbeddings.Add(embedding);
        return Task.CompletedTask;
    }

    public Task UpdateEmbeddingAsync(NoteEmbedding embedding, CancellationToken cancellationToken = default)
    {
        Context.NoteEmbeddings.Update(embedding);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<NoteEmbedding>> GetAllEmbeddingsAsync(CancellationToken cancellationToken = default)
        => Context.NoteEmbeddings.AsNoTracking()
            .Include(e => e.Note)
            .ToListAsync(cancellationToken)
            .ContinueWith(t => (IReadOnlyList<NoteEmbedding>)t.Result);

    public async Task SyncEmbeddingToVecTableAsync(Guid noteId, float[] embedding, CancellationToken cancellationToken = default)
    {
        if (!Context.Database.IsSqlite()) return;

        try
        {
            var vectorText = $"[{string.Join(",", embedding)}]";
            await Context.Database.ExecuteSqlRawAsync(
                "INSERT OR REPLACE INTO vec_note_embeddings (note_id, embedding) VALUES ({0}, {1})",
                new[] { noteId.ToString(), vectorText },
                cancellationToken);
        }
        catch
        {
            // sqlite-vec 虚拟表未就绪时忽略，不影响主流程
        }
    }
}
