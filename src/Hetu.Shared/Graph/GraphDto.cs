namespace Hetu.Shared.Graph;

public class GraphEntityDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Metadata { get; set; }
    public int RelationCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class GraphRelationDto
{
    public Guid Id { get; set; }
    public Guid SourceEntityId { get; set; }
    public string SourceEntityName { get; set; } = string.Empty;
    public Guid TargetEntityId { get; set; }
    public string TargetEntityName { get; set; } = string.Empty;
    public string RelationType { get; set; } = string.Empty;
    public string? Description { get; set; }
    public double Confidence { get; set; }
    public Guid? SourceNoteId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class GraphDataDto
{
    public List<GraphEntityDto> Entities { get; set; } = [];
    public List<GraphRelationDto> Relations { get; set; } = [];
}

public class GraphEntityDetailDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Metadata { get; set; }
    public List<GraphRelationDto> Relations { get; set; } = [];
    public List<GraphSourceNoteDto> SourceNotes { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class GraphSourceNoteDto
{
    public Guid NoteId { get; set; }
    public string Title { get; set; } = string.Empty;
}

public class CreateGraphEntityRequest
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = "concept";
    public string? Description { get; set; }
}

public class UpdateGraphEntityRequest
{
    public string? Name { get; set; }
    public string? Type { get; set; }
    public string? Description { get; set; }
    public string? Metadata { get; set; }
}

public class CreateGraphRelationRequest
{
    public Guid SourceEntityId { get; set; }
    public Guid TargetEntityId { get; set; }
    public string RelationType { get; set; } = "related_to";
    public string? Description { get; set; }
}

public class ExtractGraphRequest
{
    public Guid NoteId { get; set; }
}

public class MergeGraphEntitiesRequest
{
    public Guid KeepEntityId { get; set; }
    public Guid MergeEntityId { get; set; }
}

public class ExtractGraphResultDto
{
    public int NewEntities { get; set; }
    public int SkippedEntities { get; set; }
    public int NewRelations { get; set; }
    public int SkippedRelations { get; set; }
}

public class BatchExtractGraphRequest
{
    public List<Guid> NoteIds { get; set; } = [];
}
