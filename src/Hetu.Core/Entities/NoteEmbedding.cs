namespace Hetu.Core.Entities;

public class NoteEmbedding
{
    public Guid NoteId { get; set; }
    public Note Note { get; set; } = null!;

    // SQLite 使用 byte[] 存储，PostgreSQL 使用 float[] 映射到 vector 类型
    public byte[] Embedding { get; set; } = [];
    public float[] Vector { get; set; } = [];

    public string Model { get; set; } = string.Empty;
    public int Dimensions { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
