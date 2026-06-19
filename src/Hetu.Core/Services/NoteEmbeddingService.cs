using Hetu.Core.Entities;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

public class NoteEmbeddingService : INoteEmbeddingService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;

    public NoteEmbeddingService(IUnitOfWork unitOfWork, IEmbeddingProviderFactory embeddingProviderFactory)
    {
        _unitOfWork = unitOfWork;
        _embeddingProviderFactory = embeddingProviderFactory;
    }

    public async Task GenerateEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null || note.IsDeleted) return;
        await GenerateEmbeddingAsync(note, cancellationToken);
    }

    public async Task GenerateEmbeddingAsync(Note note, CancellationToken cancellationToken = default)
    {
        if (note.IsDeleted) return;

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (provider == null) return;

        var text = $"{note.Title}\n\n{note.Content}";
        if (string.IsNullOrWhiteSpace(text)) return;

        var embedding = await provider.EmbedAsync(text, cancellationToken);
        var bytes = FloatArrayToBytes(embedding);

        var existing = await _unitOfWork.Notes.GetEmbeddingAsync(note.Id, cancellationToken);
        if (existing == null)
        {
            await _unitOfWork.Notes.AddEmbeddingAsync(new NoteEmbedding
            {
                NoteId = note.Id,
                Embedding = bytes,
                Vector = embedding,
                Model = "default",
                Dimensions = embedding.Length,
                UpdatedAt = DateTimeOffset.UtcNow
            }, cancellationToken);
        }
        else
        {
            existing.Embedding = bytes;
            existing.Vector = embedding;
            existing.Model = "default";
            existing.Dimensions = embedding.Length;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.Notes.UpdateEmbeddingAsync(existing, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        await _unitOfWork.Notes.SyncEmbeddingToVecTableAsync(note.Id, embedding, cancellationToken);
    }

    private static byte[] FloatArrayToBytes(float[] floats)
    {
        var bytes = new byte[floats.Length * 4];
        for (int i = 0; i < floats.Length; i++)
        {
            BitConverter.GetBytes(floats[i]).CopyTo(bytes, i * 4);
        }
        return bytes;
    }
}
