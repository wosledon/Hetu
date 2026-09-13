using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface INoteEmbeddingService
{
    /// <param name="force">为 true 时忽略已有分块与向量，强制重新生成（用于模型/维度变更后的重建）</param>
    Task GenerateEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default, bool force = false);
    Task GenerateEmbeddingAsync(Note note, CancellationToken cancellationToken = default, bool force = false);
    Task GenerateKnowledgeItemEmbeddingAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default, bool force = false);
}
