using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface ISemanticSearchStrategy
{
    Task<IReadOnlyList<NoteSearchResultDto>> SearchAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken = default);
}
