using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface INotebookRepository : IRepository<Notebook>
{
    Task<IReadOnlyList<Notebook>> GetTreeAsync(CancellationToken cancellationToken = default);
}
