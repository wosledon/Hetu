using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface INoteEmbeddingService
{
    Task GenerateEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task GenerateEmbeddingAsync(Note note, CancellationToken cancellationToken = default);
    Task GenerateKnowledgeItemEmbeddingAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default);
}
