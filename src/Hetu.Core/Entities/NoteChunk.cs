namespace Hetu.Core.Entities;

/// <summary>
/// 文档块，用于知识库分块索引
/// </summary>
public class NoteChunk : BaseEntity
{
    /// <summary>
    /// 所属知识库项目 ID
    /// </summary>
    public Guid KnowledgeItemId { get; set; }
    public KnowledgeItem? KnowledgeItem { get; set; }

    /// <summary>
    /// 块在文档中的顺序索引（从 0 开始）
    /// </summary>
    public int ChunkIndex { get; set; }

    /// <summary>
    /// 块的原始文本内容
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// LLM 生成的摘要（仅当使用大模型 Chunk 时有值）
    /// </summary>
    public string? Summary { get; set; }

    /// <summary>
    /// 分块方式: structure=结构化分块, llm=大模型分块
    /// </summary>
    public string ChunkMethod { get; set; } = "structure";
}

/// <summary>
/// 文档块的向量嵌入
/// </summary>
public class NoteChunkEmbedding
{
    public Guid ChunkId { get; set; }
    public NoteChunk Chunk { get; set; } = null!;

    // SQLite 使用 byte[] 存储，PostgreSQL 使用 float[] 映射到 vector 类型
    public byte[] Embedding { get; set; } = [];
    public float[] Vector { get; set; } = [];

    public string Model { get; set; } = string.Empty;
    public int Dimensions { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>某个知识项的分块向量聚合摘要（状态列表用：每个知识项一行，不再逐块加载）</summary>
public class ChunkEmbeddingSummary
{
    public Guid KnowledgeItemId { get; set; }
    public int ChunkCount { get; set; }
    public string? Model { get; set; }
    public int Dimensions { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>尚未建立分块向量的知识项（批量入队用：只取必要字段）</summary>
public class UnindexedKnowledgeItem
{
    public Guid Id { get; set; }
    public KnowledgeItemType Type { get; set; }
    public Guid? NoteId { get; set; }
    public string Title { get; set; } = string.Empty;
}

/// <summary>最近建立向量的知识项（概览「最近索引」用：一条一行，不加载向量字节）</summary>
public class RecentIndexedKnowledgeItem
{
    public Guid Id { get; set; }
    public KnowledgeItemType Type { get; set; }
    public string Title { get; set; } = string.Empty;
    /// <summary>已建立向量的分块数</summary>
    public int ChunkCount { get; set; }
    /// <summary>该知识项最近一次使用的 Embedding 模型</summary>
    public string? Model { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
