namespace Hetu.Shared.Notes;

public class NoteAiRequest
{
    public Guid? ModelId { get; set; }
    public string? SystemPrompt { get; set; }
}

public class ContinueNoteRequest : NoteAiRequest
{
    public string? SelectedText { get; set; }
}
