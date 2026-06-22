namespace Hetu.Core.Entities;

/// <summary>
/// 记忆向量嵌入，用于语义检索（复用 NoteEmbedding 的双存储策略）
/// </summary>
public class MemoryEmbedding : BaseEntity
{
    public Guid MemoryId { get; set; }
    public Memory? Memory { get; set; }

    /// <summary>嵌入内容（用于生成 embedding 的文本）</summary>
    public string Content { get; set; } = string.Empty;

    // SQLite 使用 byte[] 存储，PostgreSQL 使用 float[] 映射到 vector 类型
    public byte[] Embedding { get; set; } = [];
    public float[] Vector { get; set; } = [];
}
