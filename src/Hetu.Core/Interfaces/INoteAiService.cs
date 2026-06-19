using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface INoteAiService
{
    IAsyncEnumerable<string> SummarizeAsync(Guid noteId, NoteAiRequest request, CancellationToken cancellationToken = default);
    IAsyncEnumerable<string> ContinueAsync(Guid noteId, ContinueNoteRequest request, CancellationToken cancellationToken = default);
}
