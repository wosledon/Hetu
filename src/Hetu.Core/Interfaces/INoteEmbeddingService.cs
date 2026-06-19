using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface INoteEmbeddingService
{
    Task GenerateEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task GenerateEmbeddingAsync(Note note, CancellationToken cancellationToken = default);
}
