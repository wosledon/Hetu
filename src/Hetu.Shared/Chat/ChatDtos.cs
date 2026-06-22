namespace Hetu.Shared.Chat;

public class ChatGroupDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Color { get; set; }
    public string? Icon { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateChatGroupRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Color { get; set; }
    public string? Icon { get; set; }
}

public class UpdateChatGroupRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Color { get; set; }
    public string? Icon { get; set; }
    public int SortOrder { get; set; }
}

public class ChatTopicDto
{
    public Guid Id { get; set; }
    public Guid GroupId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? CustomSystemPrompt { get; set; }
    public string NoteSyncStatus { get; set; } = "pending";
    public bool IsAutoOrganizeEnabled { get; set; }
    public Guid? AutoOrganizeNotebookId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateChatTopicRequest
{
    public Guid GroupId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? CustomSystemPrompt { get; set; }
}

public class UpdateChatTopicRequest
{
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? CustomSystemPrompt { get; set; }
    public string? NoteSyncStatus { get; set; }
    public bool? IsAutoOrganizeEnabled { get; set; }
    public Guid? AutoOrganizeNotebookId { get; set; }
}

public class ChatMessageDto
{
    public Guid Id { get; set; }
    public Guid TopicId { get; set; }
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public Guid? ParentId { get; set; }
    public Guid? ModelId { get; set; }
    public int? TokensUsed { get; set; }
    public int? LatencyMs { get; set; }
    public string? ThinkingContent { get; set; }
    public string? SearchResultsJson { get; set; }
    public string? KnowledgeResultsJson { get; set; }
    public string? MemoryResultsJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class SendMessageRequest
{
    public string Content { get; set; } = string.Empty;
    /// <summary>
    /// 前端选择的模型 ID（覆盖话题默认模型）
    /// </summary>
    public string? ModelId { get; set; }
    public bool DeepThinking { get; set; }
    /// <summary>
    /// 推理强度：low / medium / high（native 模式下使用）
    /// </summary>
    public string? ReasoningEffort { get; set; }
    public bool WebSearch { get; set; }
    public bool KnowledgeBase { get; set; }
    public bool Memory { get; set; }
    /// <summary>
    /// 智能体预设的系统提示词（前端选择智能体时传入）
    /// </summary>
    public string? PresetSystemPrompt { get; set; }
    /// <summary>
    /// 图片附件列表（base64 编码的图片数据 + MIME 类型）
    /// </summary>
    public List<ImageAttachment>? Images { get; set; }
    /// <summary>
    /// 前端 /skill 选择的 Skill 名称
    /// </summary>
    public string? SkillName { get; set; }
    /// <summary>
    /// 前端选择的 Agent/PromptPreset ID
    /// </summary>
    public string? AgentId { get; set; }
    /// <summary>
    /// 用户手动启用的工具名列表（为空则使用 Agent 默认或全部工具）
    /// </summary>
    public List<string>? EnabledTools { get; set; }
    /// <summary>
    /// 用户/Agent 级别的工具审批模式覆盖
    /// </summary>
    public Dictionary<string, string>? ToolApprovalOverrides { get; set; }
    /// <summary>
    /// 是否启用工具调用（Agent Loop）
    /// </summary>
    public bool EnableTools { get; set; }
}

public class ImageAttachment
{
    public string Data { get; set; } = string.Empty;
    public string MimeType { get; set; } = "image/png";
    public string? FileName { get; set; }
}

public class WebSearchResultDto
{
    public string Title { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string Snippet { get; set; } = string.Empty;
}

public class AnswerRequest
{
    public string ToolCallId { get; set; } = string.Empty;
    public string Answer { get; set; } = string.Empty;
}

public class UpdateChatMessageRequest
{
    public string Content { get; set; } = string.Empty;
}

public class OrganizeTopicRequest
{
    public Guid? NotebookId { get; set; }
    public string Style { get; set; } = "summary";
    public string? CustomPrompt { get; set; }
}

public class OrganizeTopicResult
{
    public Guid NoteId { get; set; }
    public string Title { get; set; } = string.Empty;
}

public class PromptPresetDto
{
    public Guid Id { get; set; }
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Variables { get; set; }
    public string? ToolsConfig { get; set; }
    public bool IsBuiltIn { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreatePromptPresetRequest
{
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Variables { get; set; }
    public string? ToolsConfig { get; set; }
}

public class UpdatePromptPresetRequest
{
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Variables { get; set; }
    public string? ToolsConfig { get; set; }
    public int SortOrder { get; set; }
}
