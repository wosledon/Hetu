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

        // 确保该笔记有对应的 KnowledgeItem
        var knowledgeItem = await EnsureKnowledgeItemAsync(note, cancellationToken);

        // 尝试使用分块策略
        var chunks = await _chunkService.ChunkNoteAsync(note, cancellationToken);

        if (chunks.Count > 1)
        {
            // 多块：为每个块生成独立的 embedding
            await GenerateChunkEmbeddingsAsync(note, chunks, provider, knowledgeItem, cancellationToken);
        }
        else
        {
            // 单块或无内容：回退到整篇笔记 embedding，但仍然创建 chunk 记录以便状态追踪
            var text = $"{note.Title}\n\n{note.Content}";
            if (string.IsNullOrWhiteSpace(text)) return;

            var embedding = await provider.EmbedAsync(text, cancellationToken);
            await SaveNoteEmbeddingAsync(note.Id, embedding, provider, cancellationToken);

            // 同时保存为单个 chunk，确保知识库状态能追踪到
            await SaveSingleChunkAsync(knowledgeItem, text, embedding, provider, cancellationToken);
        }
    }

    private async Task<KnowledgeItem> EnsureKnowledgeItemAsync(Note note, CancellationToken cancellationToken)
    {
        var existing = await _unitOfWork.KnowledgeItems.GetByNoteIdAsync(note.Id, cancellationToken);
        if (existing != null) return existing;

        var item = await _unitOfWork.KnowledgeItems.AddAsync(new KnowledgeItem
        {
            Type = KnowledgeItemType.Note,
            Title = note.Title,
            Content = note.Content,
            NoteId = note.Id,
        }, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return item;
    }

    private async Task SaveSingleChunkAsync(KnowledgeItem knowledgeItem, string text, float[] embedding, IEmbeddingProvider provider, CancellationToken cancellationToken)
    {
        // 删除旧的分块
        await _unitOfWork.KnowledgeItems.DeleteChunksAsync(knowledgeItem.Id, cancellationToken);

        var chunk = new NoteChunk
        {
            Id = Guid.NewGuid(),
            KnowledgeItemId = knowledgeItem.Id,
            ChunkIndex = 0,
            Content = text,
            ChunkMethod = "structure",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await _unitOfWork.KnowledgeItems.AddChunksAsync(new[] { chunk }, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var bytes = FloatArrayToBytes(embedding);
        var existingEmb = await _unitOfWork.KnowledgeItems.GetChunkEmbeddingAsync(chunk.Id, cancellationToken);
        if (existingEmb == null)
        {
            await _unitOfWork.KnowledgeItems.AddChunkEmbeddingAsync(new NoteChunkEmbedding
            {
                ChunkId = chunk.Id,
                Embedding = bytes,
                Vector = embedding,
                Model = "default",
                Dimensions = embedding.Length,
                UpdatedAt = DateTimeOffset.UtcNow
            }, cancellationToken);
        }
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        await _unitOfWork.KnowledgeItems.SyncChunkEmbeddingToVecTableAsync(chunk.Id, embedding, cancellationToken);
    }

    private async Task GenerateChunkEmbeddingsAsync(Note note, List<NoteChunk> chunks, IEmbeddingProvider provider, KnowledgeItem knowledgeItem, CancellationToken cancellationToken)
    {
        // 删除旧的分块
        await _unitOfWork.KnowledgeItems.DeleteChunksAsync(knowledgeItem.Id, cancellationToken);

        // 设置分块的 KnowledgeItemId
        foreach (var chunk in chunks)
        {
            chunk.KnowledgeItemId = knowledgeItem.Id;
        }

        // 保存新的分块
        await _unitOfWork.KnowledgeItems.AddChunksAsync(chunks, cancellationToken);
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

            var existing = await _unitOfWork.KnowledgeItems.GetChunkEmbeddingAsync(chunk.Id, cancellationToken);
            if (existing == null)
            {
                await _unitOfWork.KnowledgeItems.AddChunkEmbeddingAsync(new NoteChunkEmbedding
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
                await _unitOfWork.KnowledgeItems.UpdateChunkEmbeddingAsync(existing, cancellationToken);
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);
            await _unitOfWork.KnowledgeItems.SyncChunkEmbeddingToVecTableAsync(chunk.Id, embedding, cancellationToken);
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

    public async Task GenerateKnowledgeItemEmbeddingAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default)
    {
        var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(knowledgeItemId, cancellationToken);
        if (item == null || item.IsDeleted) return;

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (provider == null) return;

        var text = item.Content;
        if (string.IsNullOrWhiteSpace(text)) return;

        // 使用分块策略
        var chunks = await _chunkService.ChunkTextAsync(text, cancellationToken);
        if (chunks == null || chunks.Count == 0) return;

        // 删除旧的分块
        await _unitOfWork.KnowledgeItems.DeleteChunksAsync(item.Id, cancellationToken);

        // 设置分块的 KnowledgeItemId
        foreach (var chunk in chunks)
        {
            chunk.KnowledgeItemId = item.Id;
        }

        // 保存新的分块
        await _unitOfWork.KnowledgeItems.AddChunksAsync(chunks, cancellationToken);
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

            var existing = await _unitOfWork.KnowledgeItems.GetChunkEmbeddingAsync(chunk.Id, cancellationToken);
            if (existing == null)
            {
                await _unitOfWork.KnowledgeItems.AddChunkEmbeddingAsync(new NoteChunkEmbedding
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
                await _unitOfWork.KnowledgeItems.UpdateChunkEmbeddingAsync(existing, cancellationToken);
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);
            await _unitOfWork.KnowledgeItems.SyncChunkEmbeddingToVecTableAsync(chunk.Id, embedding, cancellationToken);
        }
    }
}
