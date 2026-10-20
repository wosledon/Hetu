using Hetu.Shared.Common;

namespace Hetu.Shared.Notes;

public class SearchNotesRequest : PagedRequest
{
    public string Keyword { get; set; } = string.Empty;
    public Guid? TagId { get; set; }
    public bool IncludeDeleted { get; set; }
}

public class NoteSearchResultDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? ContentSnippet { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
