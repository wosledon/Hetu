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

    public async Task<IReadOnlyList<Note>> GetListAsync(Guid? notebookId = null, Guid? tagId = null, bool includeDeleted = false, bool filterNoNotebook = false, CancellationToken cancellationToken = default)
        => (await GetPagedAsync(notebookId, tagId, includeDeleted, filterNoNotebook, 0, int.MaxValue, cancellationToken)).Items;

    public async Task<(IReadOnlyList<Note> Items, int Total)> GetPagedAsync(
        Guid? notebookId, Guid? tagId, bool includeDeleted, bool filterNoNotebook,
        int skip, int take, CancellationToken cancellationToken = default)
    {
        var query = DbSet.AsNoTracking();
        if (includeDeleted) query = query.IgnoreQueryFilters();

        query = query.Where(n => includeDeleted || !n.IsDeleted);

        if (filterNoNotebook)
            query = query.Where(n => n.NotebookId == null);
        else if (notebookId.HasValue)
            query = query.Where(n => n.NotebookId == notebookId.Value);

        if (tagId.HasValue)
            query = query.Where(n => n.NoteTags.Any(nt => nt.TagId == tagId.Value));

        // 计数走 SQL COUNT：分页只需要总量，不再把全部笔记读进内存
        var total = await query.CountAsync(cancellationToken);
        if (take <= 0) return (Array.Empty<Note>(), total);

        if (Context.Database.IsSqlite())
        {
            // SQLite 的 EF provider 不支持在 SQL 中排序 DateTimeOffset：
            // 取全量时直接加载后内存排序；分页时只投影排序键（三列，不含正文/标签）定序，再按 Id 回表取分页数据。
            if (skip <= 0 && take >= total)
            {
                var all = await IncludeTags(query).ToListAsync(cancellationToken);
                return (SortLocally(all), total);
            }

            var keys = await query
                .Select(n => new { n.Id, n.IsPinned, n.UpdatedAt })
                .ToListAsync(cancellationToken);

            var pageIds = keys
                .OrderByDescending(k => k.IsPinned)
                .ThenByDescending(k => k.UpdatedAt)
                .Skip(skip)
                .Take(take)
                .Select(k => k.Id)
                .ToList();

            var page = await IncludeTags(query).Where(n => pageIds.Contains(n.Id)).ToListAsync(cancellationToken);
            // 回表走 IN 查询，结果顺序不保证，按分页顺序重排
            var byId = page.ToDictionary(n => n.Id);
            return (pageIds.Where(byId.ContainsKey).Select(id => byId[id]).ToList(), total);
        }

        // PostgreSQL 等 provider：排序与 OFFSET/FETCH 全部在 SQL 完成
        var items = await IncludeTags(query)
            .OrderByDescending(n => n.IsPinned)
            .ThenByDescending(n => n.UpdatedAt)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);

        return (items, total);
    }

    private static IQueryable<Note> IncludeTags(IQueryable<Note> query)
        => query.Include(n => n.NoteTags).ThenInclude(nt => nt.Tag);

    private static List<Note> SortLocally(IEnumerable<Note> notes)
        => notes.OrderByDescending(n => n.IsPinned).ThenByDescending(n => n.UpdatedAt).ToList();

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

    public async Task UnassignNotebookAsync(Guid notebookId, CancellationToken cancellationToken = default)
    {
        await DbSet
            .Where(n => n.NotebookId == notebookId)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.NotebookId, (Guid?)null), cancellationToken);
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

        // SQLite 提供程序不支持 DateTimeOffset 排序比较，cutoff 过滤只能在内存中完成
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

    public async Task DeleteEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default)
    {
        var embedding = await Context.NoteEmbeddings
            .FirstOrDefaultAsync(e => e.NoteId == noteId, cancellationToken);
        if (embedding != null)
            Context.NoteEmbeddings.Remove(embedding);
    }

    public async Task<IReadOnlyList<NoteEmbedding>> GetAllEmbeddingsAsync(CancellationToken cancellationToken = default)
    {
        var result = await Context.NoteEmbeddings.AsNoTracking()
            .Include(e => e.Note)
            .ToListAsync(cancellationToken);
        return result;
    }

    public async Task SyncEmbeddingToVecTableAsync(Guid noteId, float[] embedding, CancellationToken cancellationToken = default)
    {
        if (!Context.Database.IsSqlite()) return;

        try
        {
            var connection = Context.Database.GetDbConnection();
            if (connection.State != System.Data.ConnectionState.Open)
                await connection.OpenAsync(cancellationToken);

            await using var command = connection.CreateCommand();
            var vectorText = $"[{string.Join(",", embedding)}]";
            command.CommandText = $"INSERT OR REPLACE INTO vec_note_embeddings (note_id, embedding) VALUES ('{noteId}', '{vectorText}')";
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch
        {
            // sqlite-vec 虚拟表未就绪时忽略，不影响主流程
        }
    }
}
