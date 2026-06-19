namespace Hetu.Core.Entities;

public class GraphEntity : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = "concept";
    public string? Description { get; set; }
    public string? Metadata { get; set; }
    public List<GraphRelation> OutgoingRelations { get; set; } = [];
    public List<GraphRelation> IncomingRelations { get; set; } = [];
}
