using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class NotebookRepository : EfRepository<Notebook>, INotebookRepository
{
    public NotebookRepository(HetuDbContext context) : base(context) { }

    public async Task<IReadOnlyList<Notebook>> GetTreeAsync(CancellationToken cancellationToken = default)
    {
        var all = await DbSet
            .AsNoTracking()
            .OrderBy(n => n.SortOrder)
            .ThenBy(n => n.Name)
            .ToListAsync(cancellationToken);

        foreach (var notebook in all)
        {
            notebook.Children = [];
        }

        var byId = all.ToDictionary(n => n.Id);
        var roots = new List<Notebook>();

        foreach (var notebook in all)
        {
            if (notebook.ParentId.HasValue && byId.TryGetValue(notebook.ParentId.Value, out var parent))
            {
                parent.Children.Add(notebook);
            }
            else
            {
                roots.Add(notebook);
            }
        }

        return roots;
    }
}
