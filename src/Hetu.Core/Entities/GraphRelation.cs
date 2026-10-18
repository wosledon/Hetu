namespace Hetu.Core.Entities;

public class GraphRelation : BaseEntity
{
    public Guid SourceEntityId { get; set; }
    public GraphEntity? SourceEntity { get; set; }

    public Guid TargetEntityId { get; set; }
    public GraphEntity? TargetEntity { get; set; }

    public string RelationType { get; set; } = "related_to";
    public string? Description { get; set; }
    public double Confidence { get; set; } = 1.0;

    public Guid? SourceNoteId { get; set; }

    /// <summary>来源 Wiki 页面 ID（从项目 Wiki 抽取时有值）</summary>
    public Guid? SourceWikiDocumentId { get; set; }

    public bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
