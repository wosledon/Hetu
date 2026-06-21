namespace Hetu.Shared.Notes;

public class NoteChunkDto
{
    public Guid Id { get; set; }
    public Guid NoteId { get; set; }
    public int ChunkIndex { get; set; }
    public string Content { get; set; } = string.Empty;
    public string? Summary { get; set; }
    public string ChunkMethod { get; set; } = "structure";
    public bool HasEmbedding { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class NoteChunkStatusDto
{
    public Guid NoteId { get; set; }
    public string Title { get; set; } = string.Empty;
    public int ChunkCount { get; set; }
    public int EmbeddedChunkCount { get; set; }
    public string? ChunkMethod { get; set; }
    public DateTimeOffset? LastChunkedAt { get; set; }
}

public class ChunkSearchResultDto
{
    public Guid NoteId { get; set; }
    public string NoteTitle { get; set; } = string.Empty;
    public Guid ChunkId { get; set; }
    public int ChunkIndex { get; set; }
    public string ContentSnippet { get; set; } = string.Empty;
    public string? Summary { get; set; }
    public float Score { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
