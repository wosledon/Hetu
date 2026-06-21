using Hetu.Core.Entities;
using Hetu.Shared.Notes;

namespace Hetu.Core.Interfaces;

public interface IChunkService
{
    /// <summary>
    /// 对笔记进行分块。如果配置了 Chunk 模型则使用 LLM，否则使用结构化分块。
    /// </summary>
    Task<List<NoteChunk>> ChunkNoteAsync(Note note, CancellationToken cancellationToken = default);

    /// <summary>
    /// 使用结构化方式分块（按标题/段落拆分）
    /// </summary>
    List<NoteChunk> ChunkByStructure(Note note);

    /// <summary>
    /// 使用 LLM 方式分块（总结 + 分块）
    /// </summary>
    Task<List<NoteChunk>> ChunkByLLMAsync(Note note, ILLMProvider llm, string modelId, CancellationToken cancellationToken = default);
}
