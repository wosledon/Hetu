namespace Hetu.Core.Entities;

public class ChatGroup : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Color { get; set; }
    public string? Icon { get; set; }
    public int SortOrder { get; set; }
    public List<ChatTopic> Topics { get; set; } = [];
}
