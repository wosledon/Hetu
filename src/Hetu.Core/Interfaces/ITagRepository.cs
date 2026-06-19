using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface ITagRepository : IRepository<Tag>
{
    Task<Tag?> GetByNameAsync(string name, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Tag>> GetByNoteAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task<Dictionary<Guid, int>> GetNoteCountsAsync(CancellationToken cancellationToken = default);
}
