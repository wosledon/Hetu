using Hetu.Core.Entities;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

public class NoteEmbeddingService : INoteEmbeddingService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly IChunkService _chunkService;

    public NoteEmbeddingService(IUnitOfWork unitOfWork, IEmbeddingProviderFactory embeddingProviderFactory, IChunkService chunkService)
    {
        _unitOfWork = unitOfWork;
        _embeddingProviderFactory = embeddingProviderFactory;
        _chunkService = chunkService;
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

        // 尝试使用分块策略
        var chunks = await _chunkService.ChunkNoteAsync(note, cancellationToken);

        if (chunks.Count > 1)
        {
            // 多块：为每个块生成独立的 embedding
            await GenerateChunkEmbeddingsAsync(note, chunks, provider, cancellationToken);
        }
        else
        {
            // 单块或无内容：回退到整篇笔记 embedding
            var text = $"{note.Title}\n\n{note.Content}";
            if (string.IsNullOrWhiteSpace(text)) return;

            var embedding = await provider.EmbedAsync(text, cancellationToken);
            await SaveNoteEmbeddingAsync(note.Id, embedding, provider, cancellationToken);
        }
    }

    private async Task GenerateChunkEmbeddingsAsync(Note note, List<NoteChunk> chunks, IEmbeddingProvider provider, CancellationToken cancellationToken)
    {
        // 删除旧的分块
        await _unitOfWork.Notes.DeleteChunksAsync(note.Id, cancellationToken);

        // 保存新的分块
        await _unitOfWork.Notes.AddChunksAsync(chunks, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 为每个块生成 embedding
        foreach (var chunk in chunks)
        {
            var textToEmbed = !string.IsNullOrWhiteSpace(chunk.Summary)
                ? $"{chunk.Summary}\n\n{chunk.Content}"
                : chunk.Content;

            if (string.IsNullOrWhiteSpace(textToEmbed)) continue;

            var embedding = await provider.EmbedAsync(textToEmbed, cancellationToken);
            var bytes = FloatArrayToBytes(embedding);

            var existing = await _unitOfWork.Notes.GetChunkEmbeddingAsync(chunk.Id, cancellationToken);
            if (existing == null)
            {
                await _unitOfWork.Notes.AddChunkEmbeddingAsync(new NoteChunkEmbedding
                {
                    ChunkId = chunk.Id,
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
                await _unitOfWork.Notes.UpdateChunkEmbeddingAsync(existing, cancellationToken);
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);
            await _unitOfWork.Notes.SyncChunkEmbeddingToVecTableAsync(chunk.Id, embedding, cancellationToken);
        }

        // 同时删除旧的整篇笔记 embedding（如果有）
        var oldNoteEmbedding = await _unitOfWork.Notes.GetEmbeddingAsync(note.Id, cancellationToken);
        // NoteEmbedding 没有直接删除方法，但会被 chunk 替代
    }

    private async Task SaveNoteEmbeddingAsync(Guid noteId, float[] embedding, IEmbeddingProvider provider, CancellationToken cancellationToken)
    {
        var bytes = FloatArrayToBytes(embedding);

        var existing = await _unitOfWork.Notes.GetEmbeddingAsync(noteId, cancellationToken);
        if (existing == null)
        {
            await _unitOfWork.Notes.AddEmbeddingAsync(new NoteEmbedding
            {
                NoteId = noteId,
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
        await _unitOfWork.Notes.SyncEmbeddingToVecTableAsync(noteId, embedding, cancellationToken);
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
