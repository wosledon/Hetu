namespace Hetu.Core.Entities;

public class ChatGroup : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Color { get; set; }
    public string? Icon { get; set; }
    public int SortOrder { get; set; }
    /// <summary>是否为主对话组（全局主对话，展示 AI 主动任务与全局聊天）</summary>
    public bool IsMain { get; set; }
    public List<ChatTopic> Topics { get; set; } = [];
}
