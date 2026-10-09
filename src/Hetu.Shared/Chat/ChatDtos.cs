namespace Hetu.Shared.Chat;

public class ChatGroupDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Color { get; set; }
    public string? Icon { get; set; }
    public int SortOrder { get; set; }
    public bool IsMain { get; set; }
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

/// <summary>主对话（全局主对话组 + 唯一主话题）</summary>
public class MainChatDto
{
    public ChatGroupDto Group { get; set; } = null!;
    public ChatTopicDto Topic { get; set; } = null!;
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
    public bool IsMain { get; set; }
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
    /// <summary>命中缓存的 Token 数（用于展示缓存占比）</summary>
    public int? CachedTokens { get; set; }
    public int? LatencyMs { get; set; }
    public string? ThinkingContent { get; set; }
    public string? SearchResultsJson { get; set; }
    public string? KnowledgeResultsJson { get; set; }
    public string? MemoryResultsJson { get; set; }
    /// <summary>本轮工具调用流水 JSON（名称/参数/结果），供前端瀑布流还原执行过程</summary>
    public string? ToolCallsJson { get; set; }
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
    /// 输入框 @ 引用的内容（笔记/笔记本/标签/知识项），后端解析为上下文注入
    /// </summary>
    public List<ChatMentionRef>? Mentions { get; set; }
    /// <summary>
    /// 会话级上下文上限（token）：选择更小的上下文窗口时，历史消息按该预算裁剪；
    /// 为空表示用模型支持的上限
    /// </summary>
    public int? ContextWindow { get; set; }
    /// <summary>
    /// 用户手动启用的工具名列表（为空则使用 Agent 默认或全部工具）
    /// </summary>
    public List<string>? EnabledTools { get; set; }
    /// <summary>
    /// 用户/Agent 级别的工具审批模式覆盖
    /// </summary>
    public Dictionary<string, string>? ToolApprovalOverrides { get; set; }
    /// <summary>
    /// 会话权限模式：plan / readonly / ask / auto / bypass。
    /// 与编码会话共用同一套五档语义，由后端按工具风险等级折算为逐次审批决策。
    /// </summary>
    public string? PermissionMode { get; set; }
    /// <summary>
    /// 是否启用工具调用（Agent Loop）
    /// </summary>
    public bool EnableTools { get; set; }
}

/// <summary>@ 引用：type 取值 note | notebook | tag | knowledge</summary>
public class ChatMentionRef
{
    public string Type { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
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
    public string SessionId { get; set; } = string.Empty;
    public string ToolCallId { get; set; } = string.Empty;
    public string Answer { get; set; } = string.Empty;
}

public class ApprovalRequest
{
    public string SessionId { get; set; } = string.Empty;
    public string ToolCallId { get; set; } = string.Empty;
    public bool Approve { get; set; }
}

public class PlanDecisionRequest
{
    public string SessionId { get; set; } = string.Empty;
    public string ToolCallId { get; set; } = string.Empty;
    public bool Approved { get; set; }
    public string? Feedback { get; set; }
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
    /// <summary>智能体类型：General（通用）| Professional（专业）</summary>
    public string AgentType { get; set; } = "General";
    /// <summary>专业智能体可管理的子智能体 ID 列表（JSON 数组）</summary>
    public string? SubAgentIds { get; set; }
    /// <summary>专业智能体绑定的模型 ID</summary>
    public Guid? ModelId { get; set; }
    /// <summary>专业智能体指定的模型推理强度</summary>
    public string? ReasoningEffort { get; set; }
    /// <summary>专业智能体可使用的技能 ID 列表（JSON 数组）</summary>
    public string? SkillIds { get; set; }
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
    /// <summary>智能体类型：General（通用）| Professional（专业）</summary>
    public string AgentType { get; set; } = "General";
    /// <summary>专业智能体可管理的子智能体 ID 列表（JSON 数组）</summary>
    public string? SubAgentIds { get; set; }
    /// <summary>专业智能体绑定的模型 ID</summary>
    public Guid? ModelId { get; set; }
    /// <summary>专业智能体指定的模型推理强度</summary>
    public string? ReasoningEffort { get; set; }
    /// <summary>专业智能体可使用的技能 ID 列表（JSON 数组）</summary>
    public string? SkillIds { get; set; }
}

public class UpdatePromptPresetRequest
{
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Variables { get; set; }
    public string? ToolsConfig { get; set; }
    public int SortOrder { get; set; }
    /// <summary>智能体类型：General（通用）| Professional（专业）</summary>
    public string AgentType { get; set; } = "General";
    /// <summary>专业智能体可管理的子智能体 ID 列表（JSON 数组）</summary>
    public string? SubAgentIds { get; set; }
    /// <summary>专业智能体绑定的模型 ID</summary>
    public Guid? ModelId { get; set; }
    /// <summary>专业智能体指定的模型推理强度</summary>
    public string? ReasoningEffort { get; set; }
    /// <summary>专业智能体可使用的技能 ID 列表（JSON 数组）</summary>
    public string? SkillIds { get; set; }
}

public class LocalPromptPresetDto
{
    public string Id { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Variables { get; set; }
    public string? ToolsConfig { get; set; }
    public bool IsEnabled { get; set; } = true;
    public string FilePath { get; set; } = string.Empty;
    public string Source { get; set; } = "local";
}
