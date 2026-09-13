using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

public class NoteEmbeddingService : INoteEmbeddingService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly IChunkService _chunkService;
    private readonly ILogger<NoteEmbeddingService> _logger;

    public NoteEmbeddingService(IUnitOfWork unitOfWork, IEmbeddingProviderFactory embeddingProviderFactory, IChunkService chunkService, ILogger<NoteEmbeddingService> logger)
    {
        _unitOfWork = unitOfWork;
        _embeddingProviderFactory = embeddingProviderFactory;
        _chunkService = chunkService;
        _logger = logger;
    }

    public async Task GenerateEmbeddingAsync(Guid noteId, CancellationToken cancellationToken = default, bool force = false)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null || note.IsDeleted) return;
        await GenerateEmbeddingAsync(note, cancellationToken, force);
    }

    public async Task GenerateEmbeddingAsync(Note note, CancellationToken cancellationToken = default, bool force = false)
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
            await SaveChunksAndEmbedAsync(knowledgeItem.Id, chunks, provider, cancellationToken, force);
        }
        else
        {
            // 单块或无内容：回退到整篇笔记 embedding，但仍然创建 chunk 记录以便状态追踪
            var text = $"{note.Title}\n\n{note.Content}";
            if (string.IsNullOrWhiteSpace(text)) return;

            // 未强制重建且内容与向量都已是最新时跳过，避免任务中断重跑时重复消耗算力
            if (!force && await IsNoteEmbeddingUpToDateAsync(note.Id, knowledgeItem.Id, text, provider, cancellationToken))
            {
                _logger.LogDebug("笔记 {NoteId} 的分块与向量均为最新，跳过 Embedding 生成", note.Id);
                return;
            }

            var embedding = await provider.EmbedAsync(text, cancellationToken);
            await SaveNoteEmbeddingAsync(note.Id, embedding, provider, cancellationToken);

            // 同时保存为单个 chunk，确保知识库状态能追踪到
            await SaveSingleChunkAsync(knowledgeItem, text, embedding, provider, cancellationToken);
        }
    }

    /// <summary>
    /// 判断单分块笔记的笔记级与分块级向量是否都已是最新（内容一致且维度匹配），并顺带修复向量表
    /// </summary>
    private async Task<bool> IsNoteEmbeddingUpToDateAsync(Guid noteId, Guid knowledgeItemId, string text, IEmbeddingProvider provider, CancellationToken cancellationToken)
    {
        var chunks = await _unitOfWork.KnowledgeItems.GetChunksAsync(knowledgeItemId, cancellationToken);
        var chunk = chunks.Count == 1 ? chunks[0] : null;
        if (chunk == null || chunk.Content != text) return false;

        var chunkEmbedding = await _unitOfWork.KnowledgeItems.GetChunkEmbeddingAsync(chunk.Id, cancellationToken);
        if (chunkEmbedding == null || chunkEmbedding.Dimensions != provider.Dimensions) return false;

        var noteEmbedding = await _unitOfWork.Notes.GetEmbeddingAsync(noteId, cancellationToken);
        if (noteEmbedding == null || noteEmbedding.Dimensions != provider.Dimensions) return false;

        // 上次进程可能在写入向量表前被中断，这里补写一次（幂等）
        var chunkVector = BytesToFloatArray(chunkEmbedding.Embedding);
        if (chunkVector.Length == provider.Dimensions)
            await _unitOfWork.KnowledgeItems.SyncChunkEmbeddingToVecTableAsync(chunk.Id, chunkVector, cancellationToken);

        var noteVector = BytesToFloatArray(noteEmbedding.Embedding);
        if (noteVector.Length == provider.Dimensions)
            await _unitOfWork.Notes.SyncEmbeddingToVecTableAsync(noteId, noteVector, cancellationToken);

        return true;
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

    /// <summary>
    /// 保存分块并生成向量。未强制重建时会复用内容未变的分块与其已有向量，
    /// 使任务在进程中断后可以续跑，而不是从头重新生成。
    /// </summary>
    private async Task SaveChunksAndEmbedAsync(Guid knowledgeItemId, List<NoteChunk> chunks, IEmbeddingProvider provider, CancellationToken cancellationToken, bool force = false)
    {
        var existingChunks = force
            ? new List<NoteChunk>()
            : (await _unitOfWork.KnowledgeItems.GetChunksAsync(knowledgeItemId, cancellationToken)).ToList();

        var embeddedChunkIds = force
            ? new HashSet<Guid>()
            : (await _unitOfWork.KnowledgeItems.GetEmbeddedChunkIdsAsync(knowledgeItemId, cancellationToken)).ToHashSet();

        var existingByIndex = new Dictionary<int, NoteChunk>();
        foreach (var existing in existingChunks)
            existingByIndex[existing.ChunkIndex] = existing;

        var obsoleteChunkIds = existingChunks.Select(c => c.Id).ToHashSet();
        var chunksToInsert = new List<NoteChunk>();
        var chunksToEmbed = new List<NoteChunk>();

        foreach (var chunk in chunks)
        {
            chunk.KnowledgeItemId = knowledgeItemId;

            if (existingByIndex.TryGetValue(chunk.ChunkIndex, out var existing) &&
                existing.Content == chunk.Content &&
                (existing.Summary ?? string.Empty) == (chunk.Summary ?? string.Empty))
            {
                // 内容未变：复用原分块记录，避免删除重建导致已完成的向量失效
                chunk.Id = existing.Id;
                obsoleteChunkIds.Remove(existing.Id);

                if (embeddedChunkIds.Contains(existing.Id))
                {
                    var existingEmbedding = await _unitOfWork.KnowledgeItems.GetChunkEmbeddingAsync(existing.Id, cancellationToken);
                    if (existingEmbedding != null && existingEmbedding.Dimensions == provider.Dimensions)
                    {
                        // 向量已就绪：只补写向量表（上次可能中断在写向量表之前）
                        var vector = BytesToFloatArray(existingEmbedding.Embedding);
                        if (vector.Length == provider.Dimensions)
                            await _unitOfWork.KnowledgeItems.SyncChunkEmbeddingToVecTableAsync(existing.Id, vector, cancellationToken);
                        continue;
                    }
                }
            }
            else
            {
                chunksToInsert.Add(chunk);
            }

            chunksToEmbed.Add(chunk);
        }

        if (force)
        {
            // 强制重建：先移除该知识项下全部分块与向量
            await _unitOfWork.KnowledgeItems.DeleteChunksAsync(knowledgeItemId, cancellationToken);
        }
        else if (obsoleteChunkIds.Count > 0)
        {
            await _unitOfWork.KnowledgeItems.DeleteChunksByIdsAsync(obsoleteChunkIds, cancellationToken);
        }

        if (chunksToInsert.Count > 0)
            await _unitOfWork.KnowledgeItems.AddChunksAsync(chunksToInsert, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        foreach (var chunk in chunksToEmbed)
        {
            var textToEmbed = !string.IsNullOrWhiteSpace(chunk.Summary)
                ? $"{chunk.Summary}\n\n{chunk.Content}"
                : chunk.Content;

            if (string.IsNullOrWhiteSpace(textToEmbed)) continue;

            try
            {
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
            catch (Exception ex)
            {
                _logger.LogError(ex, "生成分块嵌入失败 knowledgeItemId={KnowledgeItemId} chunkIndex={ChunkIndex}", knowledgeItemId, chunk.ChunkIndex);
                throw;
            }
        }
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

    private static float[] BytesToFloatArray(byte[]? bytes)
    {
        if (bytes == null || bytes.Length < 4) return Array.Empty<float>();

        var floats = new float[bytes.Length / 4];
        for (int i = 0; i < floats.Length; i++)
        {
            floats[i] = BitConverter.ToSingle(bytes, i * 4);
        }
        return floats;
    }

    public async Task GenerateKnowledgeItemEmbeddingAsync(Guid knowledgeItemId, CancellationToken cancellationToken = default, bool force = false)
    {
        var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(knowledgeItemId, cancellationToken);
        if (item == null || item.IsDeleted)
        {
            _logger.LogWarning("[KI Embed] 知识项不存在或已删除 id={Id}", knowledgeItemId);
            return;
        }

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (provider == null)
        {
            _logger.LogWarning("[KI Embed] 未配置 Embedding 模型，跳过索引 id={Id}", knowledgeItemId);
            return;
        }

        var text = item.Content;
        if (string.IsNullOrWhiteSpace(text))
        {
            _logger.LogWarning("[KI Embed] 知识项内容为空 id={Id} type={Type}", knowledgeItemId, item.Type);
            return;
        }

        _logger.LogInformation("[KI Embed] 开始索引 id={Id} type={Type} contentLen={Len}", knowledgeItemId, item.Type, text.Length);

        // 使用分块策略
        var chunks = await _chunkService.ChunkTextAsync(text, cancellationToken);
        if (chunks == null || chunks.Count == 0)
        {
            _logger.LogWarning("[KI Embed] 分块结果为空 id={Id}", knowledgeItemId);
            return;
        }

        _logger.LogInformation("[KI Embed] 分块完成 id={Id} chunkCount={Count}", knowledgeItemId, chunks.Count);

        await SaveChunksAndEmbedAsync(item.Id, chunks, provider, cancellationToken, force);

        _logger.LogInformation("[KI Embed] 索引完成 id={Id} chunkCount={Count}", knowledgeItemId, chunks.Count);
    }
}
