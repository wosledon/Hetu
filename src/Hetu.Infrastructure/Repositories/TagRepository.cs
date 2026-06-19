using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class TagRepository : EfRepository<Tag>, ITagRepository
{
    public TagRepository(HetuDbContext context) : base(context) { }

    public Task<Tag?> GetByNameAsync(string name, CancellationToken cancellationToken = default)
        => DbSet.AsNoTracking().FirstOrDefaultAsync(t => t.Name.ToLower() == name.ToLower(), cancellationToken);

    public async Task<IReadOnlyList<Tag>> GetByNoteAsync(Guid noteId, CancellationToken cancellationToken = default)
    {
        return await Context.NoteTags
            .AsNoTracking()
            .Where(nt => nt.NoteId == noteId)
            .Select(nt => nt.Tag)
            .ToListAsync(cancellationToken);
    }

    public async Task<Dictionary<Guid, int>> GetNoteCountsAsync(CancellationToken cancellationToken = default)
    {
        var counts = await Context.NoteTags
            .AsNoTracking()
            .GroupBy(nt => nt.TagId)
            .Select(g => new { TagId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return counts.ToDictionary(x => x.TagId, x => x.Count);
    }
}
