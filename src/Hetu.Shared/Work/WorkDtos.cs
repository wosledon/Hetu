using Hetu.Shared.Chat;

namespace Hetu.Shared.Work;

public class WorkProjectDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string RootPath { get; set; } = string.Empty;
    /// <summary>连接类型：Local | Ssh</summary>
    public string ConnectionType { get; set; } = "Local";
    public string? SshHost { get; set; }
    public int SshPort { get; set; } = 22;
    public string? SshUser { get; set; }
    /// <summary>Key | Password | Agent</summary>
    public string SshAuthType { get; set; } = "Key";
    public string? SshKeyPath { get; set; }
    /// <summary>是否已保存 SSH 密码（不回传明文）</summary>
    public bool HasSshPassword { get; set; }
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    public int SortOrder { get; set; }
    public int SessionCount { get; set; }
    /// <summary>启用的 MCP 服务器 ID</summary>
    public List<Guid> McpServerIds { get; set; } = [];
    /// <summary>启用的本地技能 ID</summary>
    public List<string> SkillIds { get; set; } = [];
    /// <summary>诊断命令（构建/静态检查），留空时自动探测</summary>
    public string? DiagnosticsCommand { get; set; }
    /// <summary>代码语义索引状态</summary>
    public WorkCodeIndexStatusDto CodeIndex { get; set; } = new();
    /// <summary>关联的项目管理条目 ID；为空表示未与项目管理互通</summary>
    public Guid? ManagedProjectId { get; set; }
    /// <summary>所属分组 ID（取自关联的项目管理条目）</summary>
    public Guid? GroupId { get; set; }
    /// <summary>所属分组名称</summary>
    public string? GroupName { get; set; }
    /// <summary>分类（取自关联的项目管理条目）</summary>
    public string? Category { get; set; }
    /// <summary>标签（取自关联的项目管理条目）</summary>
    public List<string> Tags { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>代码语义索引状态</summary>
public class WorkCodeIndexStatusDto
{
    public int ChunkCount { get; set; }
    public int FileCount { get; set; }
    public DateTimeOffset? IndexedAt { get; set; }
    /// <summary>是否已有可用索引</summary>
    public bool IsReady => ChunkCount > 0;
    /// <summary>索引后新增或修改、尚未重新索引的文件数</summary>
    public int StaleFileCount { get; set; }
    /// <summary>索引相对工作区已过期（存在未索引的变更）</summary>
    public bool IsStale { get; set; }
    /// <summary>是否存在自动刷新任务排队中</summary>
    public bool RefreshPending { get; set; }
}

public class CreateWorkProjectRequest
{
    public string Name { get; set; } = string.Empty;
    public string RootPath { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    /// <summary>Local | Ssh</summary>
    public string ConnectionType { get; set; } = "Local";
    public string? SshHost { get; set; }
    public int SshPort { get; set; } = 22;
    public string? SshUser { get; set; }
    /// <summary>Key | Password | Agent</summary>
    public string SshAuthType { get; set; } = "Key";
    public string? SshKeyPath { get; set; }
    /// <summary>SSH 密码明文（保存时加密，仅创建/更新时接收）</summary>
    public string? SshPassword { get; set; }
}

public class UpdateWorkProjectRequest
{
    public string Name { get; set; } = string.Empty;
    public string RootPath { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    public int SortOrder { get; set; }
    public List<Guid>? McpServerIds { get; set; }
    public List<string>? SkillIds { get; set; }
    public string? DiagnosticsCommand { get; set; }
    /// <summary>Local | Ssh</summary>
    public string? ConnectionType { get; set; }
    public string? SshHost { get; set; }
    public int? SshPort { get; set; }
    public string? SshUser { get; set; }
    /// <summary>Key | Password | Agent</summary>
    public string? SshAuthType { get; set; }
    public string? SshKeyPath { get; set; }
    /// <summary>SSH 密码明文（传空字符串表示清除已存密码）</summary>
    public string? SshPassword { get; set; }
}

/// <summary>本机 SSH 客户端探测结果</summary>
public class WorkSshStatusDto
{
    public bool Available { get; set; }
    public string? Version { get; set; }
    public string Os { get; set; } = string.Empty;
    /// <summary>未检测到 ssh 时的安装引导文案</summary>
    public string InstallHint { get; set; } = string.Empty;
    /// <summary>安装引导的外链（官方文档）</summary>
    public string? InstallUrl { get; set; }
}

/// <summary>SSH 连接测试结果</summary>
public class WorkSshTestResultDto
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    /// <summary>远程登录提示串（user@host），用于展示连接目标</summary>
    public string? RemoteBanner { get; set; }
}

public class WorkSessionDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    /// <summary>plan | readonly | ask | auto | bypass</summary>
    public string PermissionMode { get; set; } = "ask";
    /// <summary>Agent 模式：interactive（交互式，按权限模式确认）| autopilot（自动执行，无需逐步确认）</summary>
    public string AgentMode { get; set; } = "interactive";
    /// <summary>独立工作树用的分支名（创建后由模型按首条消息命名；null = 未进工作树）</summary>
    public string? Branch { get; set; }
    /// <summary>独立工作树路径（null = 直接在项目目录工作）</summary>
    public string? WorktreePath { get; set; }
    /// <summary>用户选择了独立工作树（首次发消息时才创建）</summary>
    public bool UseWorktree { get; set; }
    /// <summary>工作树的基分支名（null = 项目目录当前分支）</summary>
    public string? BaseBranch { get; set; }
    /// <summary>是否已有上下文摘要（/compress 或自动压缩产出）</summary>
    public bool HasContextSummary { get; set; }
    public int MessageCount { get; set; }
    /// <summary>已完成的对话轮次</summary>
    public int TurnCount { get; set; }
    public long PromptTokens { get; set; }
    public long CompletionTokens { get; set; }
    public long CachedTokens { get; set; }
    public long TotalTokens { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateWorkSessionRequest
{
    public Guid ProjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? PermissionMode { get; set; }
    public string? AgentMode { get; set; }
    /// <summary>在独立工作树中工作（仅本地 git 项目）：会话首次发消息时才创建</summary>
    public bool UseWorktree { get; set; }
    /// <summary>工作树的基分支名；留空用项目目录当前分支</summary>
    public string? BaseBranch { get; set; }
}

public class UpdateWorkSessionRequest
{
    public string Title { get; set; } = string.Empty;
    public Guid? ModelId { get; set; }
    public string? PermissionMode { get; set; }
    public string? AgentMode { get; set; }
    /// <summary>工作区：true 选用独立工作树（首次发消息时创建），false 回到项目目录（已有工作树会被删除）</summary>
    public bool? UseWorktree { get; set; }
    /// <summary>工作树的基分支名；空字符串表示回到项目当前分支</summary>
    public string? BaseBranch { get; set; }
}

/// <summary>项目可用的 git 分支与当前分支（工作树选择器用）</summary>
public class WorkBranchListDto
{
    public bool IsRepo { get; set; }
    /// <summary>项目目录当前分支</summary>
    public string? Current { get; set; }
    /// <summary>本地分支名列表（按名称排序）</summary>
    public List<string> Branches { get; set; } = [];
    /// <summary>不支持工作树的原因（SSH 项目 / 非 git 仓库等），为 null 表示可用</summary>
    public string? WorktreeUnsupportedReason { get; set; }
}

public class WorkMessageDto
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    public string Type { get; set; } = "text";
    public string? Metadata { get; set; }
    public Guid? ModelId { get; set; }
    public int? PromptTokens { get; set; }
    public int? CompletionTokens { get; set; }
    public int? CachedTokens { get; set; }
    public int? TotalTokens { get; set; }
    public int? LatencyMs { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class SendWorkMessageRequest
{
    public string Content { get; set; } = string.Empty;
    public string? ModelId { get; set; }
    public bool EnableTools { get; set; } = true;
    public string? ToolApprovalMode { get; set; }
    /// <summary>本轮权限模式（plan | readonly | ask | auto | bypass），传入时同时持久化到会话</summary>
    public string? PermissionMode { get; set; }
    /// <summary>本轮 Agent 模式（interactive | autopilot），传入时同时持久化到会话</summary>
    public string? AgentMode { get; set; }
    /// <summary>模型推理强度（low | medium | high），仅对原生推理模型生效</summary>
    public string? ReasoningEffort { get; set; }
    /// <summary>智能体（提示词预设）附加系统提示，切换 Agent 时传入</summary>
    public string? AgentPrompt { get; set; }
    /// <summary>/prompt 模板：.github/prompts 下的文件相对路径，后端读取后注入 system prompt</summary>
    public string? PromptFile { get; set; }
    /// <summary>/skill 命令选择的技能名称（项目启用的技能或 .github 技能）</summary>
    public string? SkillName { get; set; }
    /// <summary>输入框 @ 引用的内容（type: note | notebook | tag | knowledge）</summary>
    public List<ChatMentionRef>? Mentions { get; set; }
    /// <summary>会话级上下文上限（token）：按该预算裁剪历史，为空表示用模型支持的上限</summary>
    public int? ContextWindow { get; set; }
    /// <summary>本轮启用网络搜索（与对话会话共用同一套 RAG 注入）</summary>
    public bool WebSearch { get; set; }
    /// <summary>本轮启用知识库检索</summary>
    public bool KnowledgeBase { get; set; }
    /// <summary>本轮启用长期记忆检索</summary>
    public bool Memory { get; set; }
    /// <summary>深度思考开关（reasoning_mode=tag 的模型靠系统提示强制先思考）</summary>
    public bool DeepThinking { get; set; }
    /// <summary>图片附件（视觉模型多模态输入）</summary>
    public List<ImageAttachment>? Images { get; set; }
    /// <summary>是否持久化用户消息；重新生成时传 false，避免历史里重复出现同一句输入</summary>
    public bool PersistUserMessage { get; set; } = true;
}

/// <summary>GitHub Copilot 资产：项目 .github 目录自动加载的指令/智能体/提示词/技能</summary>
public class WorkCopilotAssetsDto
{
    public List<WorkCopilotAgentDto> Agents { get; set; } = [];
    public List<WorkCopilotAssetItemDto> Prompts { get; set; } = [];
    public List<WorkCopilotAssetItemDto> Skills { get; set; } = [];
    public List<WorkCopilotAssetItemDto> Instructions { get; set; } = [];
    public bool HasAssets => Agents.Count > 0 || Prompts.Count > 0 || Skills.Count > 0 || Instructions.Count > 0;
}

/// <summary>.github 自定义智能体；Content 为人设正文，切换该 Agent 时作为 AgentPrompt 下发</summary>
public class WorkCopilotAgentDto
{
    /// <summary>固定前缀 copilot: + 名称，避免与提示词预设 ID 冲突</summary>
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}

public class WorkCopilotAssetItemDto
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    /// <summary>文件正文（提示词模板 / SKILL.md），对话侧可直接作为系统提示使用</summary>
    public string Content { get; set; } = string.Empty;
}

/// <summary>文件系统条目</summary>
public class WorkFileEntryDto
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }
    public long? Size { get; set; }
    public DateTimeOffset? ModifiedAt { get; set; }
}

/// <summary>文件内容</summary>
public class WorkFileContentDto
{
    public string Path { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public long Size { get; set; }
    public bool IsBinary { get; set; }
    public string? Content { get; set; }
    public DateTimeOffset? ModifiedAt { get; set; }
}

/// <summary>文件变更记录（用于 diff 展示）</summary>
public class WorkFileChangeDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid? SessionId { get; set; }
    public string FilePath { get; set; } = string.Empty;
    public string? OldContent { get; set; }
    public string NewContent { get; set; } = string.Empty;
    public string Action { get; set; } = "write";
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>项目级工具审批规则</summary>
public class WorkApprovalRuleDto
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public string ToolName { get; set; } = "*";
    public string? PathPattern { get; set; }
    public string Decision { get; set; } = "allow";
    public bool IsEnabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}

public class CreateWorkApprovalRuleRequest
{
    public string ToolName { get; set; } = "*";
    public string? PathPattern { get; set; }
    public string Decision { get; set; } = "allow";
}

/// <summary>检查点（工具批次前的文件快照）</summary>
public class WorkCheckpointDto
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public string Label { get; set; } = string.Empty;
    public string Tools { get; set; } = string.Empty;
    public int FileCount { get; set; }
    public List<string> Files { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>检查点恢复结果</summary>
public class RestoreCheckpointResultDto
{
    public Guid CheckpointId { get; set; }
    public int RestoredCount { get; set; }
    public int DeletedCount { get; set; }
    public List<string> Errors { get; set; } = [];
}

/// <summary>项目内文件搜索结果</summary>
public class WorkFileSearchHitDto
{
    public string Path { get; set; } = string.Empty;
    public int Line { get; set; }
    public string Text { get; set; } = string.Empty;
}

/// <summary>写入文件请求</summary>
public class WriteWorkFileRequest
{
    public string Path { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    /// <summary>乐观并发校验：传入读取时的内容，若当前文件内容已变化则拒绝写入</summary>
    public string? OriginalContent { get; set; }
}

/// <summary>一次 LLM 调用的 Token 消耗</summary>
public class WorkMessageUsage
{
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public int CachedTokens { get; set; }
    public int TotalTokens { get; set; }
    public int LatencyMs { get; set; }
}

/// <summary>代码语义检索命中</summary>
public class WorkCodeSearchHitDto
{
    public string Path { get; set; } = string.Empty;
    public int StartLine { get; set; }
    public string Snippet { get; set; } = string.Empty;
    public double Score { get; set; }
}

/// <summary>检查点与当前工作区的差异</summary>
public class WorkCheckpointDiffDto
{
    public Guid CheckpointId { get; set; }
    public string Label { get; set; } = string.Empty;
    public List<WorkCheckpointDiffFileDto> Files { get; set; } = [];
    /// <summary>快照文件总数（内容因体积预算被裁剪时可能大于 Files 数量）</summary>
    public int TotalFiles { get; set; }
    /// <summary>是否存在因体积/二进制而裁剪内容的文件</summary>
    public bool Truncated { get; set; }
}

public class WorkCheckpointDiffFileDto
{
    public string Path { get; set; } = string.Empty;
    /// <summary>create | delete | write | unchanged | skipped</summary>
    public string Action { get; set; } = "write";
    public string? OldContent { get; set; }
    public string? NewContent { get; set; }
    /// <summary>内容超出体积上限，已按行裁剪</summary>
    public bool Truncated { get; set; }
    /// <summary>二进制文件，不返回内容</summary>
    public bool IsBinary { get; set; }
    /// <summary>裁剪说明（无裁剪时为 null）</summary>
    public string? Note { get; set; }
}

/// <summary>代码索引构建结果</summary>
public class WorkCodeIndexResultDto
{
    public int IndexedFiles { get; set; }
    public int IndexedChunks { get; set; }
    public int SkippedFiles { get; set; }
    public int RemovedChunks { get; set; }
    public int FailedFiles { get; set; }
    public DateTimeOffset IndexedAt { get; set; }
}

public class WorkOpenAppDto
{
    public string App { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public bool Available { get; set; }
    public string? IconUrl { get; set; }
}

public class WorkGitFileStatusDto
{
    public string Path { get; set; } = string.Empty;
    /// <summary>porcelain 状态码：M 修改 / A 新增 / D 删除 / R 重命名 / ?? 未跟踪</summary>
    public string Status { get; set; } = string.Empty;
}

public class WorkGitStatusDto
{
    public bool IsRepo { get; set; }
    public string Branch { get; set; } = string.Empty;
    public List<WorkGitFileStatusDto> Files { get; set; } = new();
}

public class WorkGitFileContentDto
{
    public string Path { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? OldContent { get; set; }
    public string? NewContent { get; set; }
    public bool IsBinary { get; set; }
}

public class WorkGitCommitRequest
{
    public string Message { get; set; } = string.Empty;
    public List<string> Paths { get; set; } = new();
}

public class WorkGitCommitResultDto
{
    public bool Success { get; set; }
    public string Output { get; set; } = string.Empty;
}
