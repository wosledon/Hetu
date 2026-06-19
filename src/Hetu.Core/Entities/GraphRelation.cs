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
}
