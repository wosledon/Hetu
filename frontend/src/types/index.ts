export interface IApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface IPagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface IPagedRequest {
  page?: number;
  pageSize?: number;
}

export interface INotebook {
  id: string;
  parentId?: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children: INotebook[];
}

export interface INote {
  id: string;
  notebookId?: string;
  title: string;
  content: string;
  isDeleted: boolean;
  isFavorite: boolean;
  isPinned: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  tags: ITag[];
}

export interface ITag {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
  noteCount?: number;
}

export interface INoteSearchResult {
  id: string;
  title: string;
  contentSnippet?: string;
  updatedAt: string;
}

export interface IAppSettingsSnapshot {
  appName: string;
  assistantName: string;
  assistantPersona: string;
  theme: 'light' | 'dark' | 'system';
  graphAutoExtract: string;
  autoEmbedding: string;
  defaultChatModelId?: string;
  defaultChunkModelId?: string;
  defaultFastModelId?: string;
  defaultEmbeddingModelId?: string;
  contextWindowSize?: number;
  pinnedNavItems: string;
  secondaryMenuStyle: string;
  navStyle: string;
  closeToTray: string;
}

export interface IAiProvider {
  id: string;
  providerType: 'openai' | 'anthropic';
  name: string;
  baseUrl?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  models: IAiModel[];
}

export interface IAiModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  purpose: 'chat' | 'embedding'
  isDefault: boolean;
  contextWindow?: number;
  dimensions?: number;
  reasoningMode: 'none' | 'tag' | 'native';
  reasoningEffort: string;
  /** 可选推理强度档位（逗号分隔，来自模型目录 models.dev） */
  reasoningEfforts?: string;
  reasoningBudgetTokens?: number;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsTools: boolean;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IChatGroup {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  isMain?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IChatTopic {
  id: string;
  groupId: string;
  title: string;
  modelId?: string;
  customSystemPrompt?: string;
  noteSyncStatus: 'pending' | 'synced' | 'outdated';
  isAutoOrganizeEnabled: boolean;
  autoOrganizeNotebookId?: string;
  isMain?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IMainChat {
  group: IChatGroup;
  topic: IChatTopic;
}

export interface IChatMessage {
  id: string;
  topicId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parentId?: string;
  modelId?: string;
  tokensUsed?: number;
  /** 命中缓存的 Token 数 */
  cachedTokens?: number;
  latencyMs?: number;
  thinkingContent?: string;
  searchResultsJson?: string;
  knowledgeResultsJson?: string;
  memoryResultsJson?: string;
  /** 本轮工具调用流水 JSON（名称/参数/结果），供瀑布流还原执行过程 */
  toolCallsJson?: string;
  createdAt: string;
}

export interface IPromptPreset {
  id: string;
  category: string;
  name: string;
  content: string;
  variables?: string;
  /** JSON: { variables: string[], tools: string[], toolApprovals: Record<string, string> } */
  toolsConfig?: string;
  isBuiltIn: boolean;
  sortOrder: number;
  /** 智能体类型：General（通用）| Professional（专业） */
  agentType: 'General' | 'Professional';
  /** 专业智能体可管理的子智能体 ID 列表（JSON 数组） */
  subAgentIds?: string;
  /** 专业智能体绑定的模型 ID */
  modelId?: string;
  /** 专业智能体指定的模型推理强度：low | medium | high */
  reasoningEffort?: string;
  /** 专业智能体可使用的技能 ID 列表（JSON 数组） */
  skillIds?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ILocalPromptPreset {
  id: string;
  category: string;
  name: string;
  content: string;
  description?: string;
  variables?: string;
  /** JSON: { variables: string[], tools: string[], toolApprovals: Record<string, string> } */
  toolsConfig?: string;
  isEnabled: boolean;
  filePath: string;
  source: string;
}

export interface ISkill {
  id: string;
  name: string;
  description: string;
  category: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  config?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface IMcpServer {
  id: string;
  name: string;
  description: string;
  type: 'stdio' | 'sse';
  connectionConfig: string;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface IMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface INoteVersion {
  id: string;
  noteId: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface IGraphEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
  metadata?: string;
  relationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IGraphRelation {
  id: string;
  sourceEntityId: string;
  sourceEntityName: string;
  targetEntityId: string;
  targetEntityName: string;
  relationType: string;
  description?: string;
  confidence: number;
  sourceNoteId?: string;
  createdAt: string;
}

export interface IGraphData {
  entities: IGraphEntity[];
  relations: IGraphRelation[];
}

export interface IGraphEntityDetail {
  id: string;
  name: string;
  type: string;
  description?: string;
  metadata?: string;
  relations: IGraphRelation[];
  sourceNotes: { noteId: string; title: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface IExtractGraphResult {
  newEntities: number;
  skippedEntities: number;
  newRelations: number;
  skippedRelations: number;
}

export interface IBatchQueueResult {
  queuedCount: number;
  /** 因已有进行中任务而跳过的数量 */
  skippedCount: number;
}

export interface IShareLink {
  id: string;
  noteId: string;
  shareCode: string;
  shareUrl: string;
  expiresAt?: string;
  viewCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface ISharedNote {
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ITaskItem {
  id: string;
  taskType: string;
  entityId: string;
  entityTitle?: string;
  status: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  durationMs?: number;
}

export interface ITaskStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  recentFailed: number;
}

export type ScheduledTaskKind = 'Skill' | 'AiTask' | 'GraphRebuild' | 'EmbeddingRegenerate';
export type ScheduleType = 'Interval' | 'Cron';
export type ScheduledTaskLastStatus = 'Running' | 'Success' | 'Failed' | null;
export type ScheduledExecutionStatus = 'Running' | 'Success' | 'Failed' | 'Queued';

export interface IScheduledTask {
  id: string;
  name: string;
  description?: string;
  taskKind: ScheduledTaskKind;
  targetId?: string;
  targetName?: string;
  parameters?: string;
  scheduleType: ScheduleType;
  intervalMinutes: number;
  cronExpression?: string;
  isEnabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: ScheduledTaskLastStatus;
  lastError?: string;
  maxRetries: number;
  retryCount: number;
  topicId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IScheduledTaskExecution {
  id: string;
  scheduledTaskId: string;
  startedAt: string;
  completedAt?: string;
  status: ScheduledExecutionStatus;
  errorMessage?: string;
  result?: string;
  retryAttempt: number;
  isManual: boolean;
  durationMs?: number;
}

export interface IScheduledTaskTargetOption {
  value: string;
  label: string;
  description: string;
  source: 'database' | 'local';
}

export interface IScheduledTaskTargetOptions {
  skills: IScheduledTaskTargetOption[];
  localSkills: IScheduledTaskTargetOption[];
}

export interface ICreateScheduledTaskRequest {
  name: string;
  description?: string;
  taskKind: ScheduledTaskKind;
  targetId?: string;
  targetName?: string;
  parameters?: string;
  scheduleType: ScheduleType;
  intervalMinutes: number;
  cronExpression?: string;
  isEnabled: boolean;
  maxRetries: number;
  topicId?: string;
}

export type IUpdateScheduledTaskRequest = ICreateScheduledTaskRequest;

export interface IMemory {
  id: string;
  content: string;
  source: string;
  topicId?: string;
  category?: string;
  importance: number;
  accessCount: number;
  lastAccessedAt: string;
  createdAt: string;
  updatedAt: string;
  score?: number;
}

/* ─── 任务看板 ─── */

export type KanbanTaskStatus = 'Backlog' | 'Todo' | 'InProgress' | 'InReview' | 'Blocked' | 'Done' | 'Archived';
export type KanbanTaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export interface IKanbanTask {
  id: string;
  title: string;
  description?: string;
  status: KanbanTaskStatus;
  priority: KanbanTaskPriority;
  assignee?: string;
  tags?: string;
  dueDate?: string;
  sortOrder: number;
  blockedReason?: string;
  completedAt?: string;
  archivedAt?: string;
  projectId?: string;
  projectName?: string;  agentId?: string;
  agentName?: string;
  /** 项目 .github 智能体正文（AgentId 为空时生效） */
  agentPrompt?: string;
  /** 项目 .github 智能体显示名 */
  agentPromptName?: string;
  workflowId?: string;
  workflowName?: string;
  hasAutomation: boolean;
  lastRunStatus?: 'Running' | 'Succeeded' | 'Failed' | 'WaitingAnswer';
  lastRunId?: string;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IKanbanTaskComment {
  id: string;
  taskId: string;
  authorType: 'User' | 'Agent' | 'System' | 'Workflow';
  authorName: string;
  content: string;
  runId?: string;
  createdAt: string;
}

export interface IKanbanTaskRun {
  id: string;
  taskId: string;
  kind: 'Agent' | 'Workflow';
  trigger: 'Todo' | 'Comment' | 'Manual';
  status: 'Running' | 'Succeeded' | 'Failed' | 'WaitingAnswer';
  input?: string;
  output?: string;
  error?: string;
  workflowRunId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

/** 执行过程步骤：思考 / 输出 / 工具调用 / 工具结果 / 工作流节点 */
export type KanbanRunStepKind = 'Thought' | 'Text' | 'ToolCall' | 'ToolResult' | 'Node';

export interface IKanbanTaskRunStep {
  id: string;
  taskId: string;
  runId: string;
  kind: KanbanRunStepKind;
  /** 工具名 / 节点名（Thought、Text 为空） */
  title?: string;
  content: string;
  isError: boolean;
  /** 同一次执行内的顺序，越小越靠前 */
  sequence: number;
  createdAt: string;
}

export interface IKanbanTaskDetail {
  task: IKanbanTask;
  comments: IKanbanTaskComment[];
  runs: IKanbanTaskRun[];
  steps: IKanbanTaskRunStep[];
}

export interface IKanbanTaskStats {
  total: number;
  active: number;
  done: number;
  archived: number;
  overdue: number;
  dueSoon: number;
}

export interface IKanbanBoard {
  backlog: IKanbanTask[];
  todo: IKanbanTask[];
  inProgress: IKanbanTask[];
  inReview: IKanbanTask[];
  blocked: IKanbanTask[];
  done: IKanbanTask[];
  archived: IKanbanTask[];
  stats: IKanbanTaskStats;
}

export interface IKanbanTaskForm {
  title: string;
  description: string;
  status: KanbanTaskStatus;
  priority: KanbanTaskPriority;
  assignee: string;
  tags: string;
  dueDate: string;
  blockedReason: string;
  projectId: string;
  /** 自动处理选择：'' 未指定 | agent:{id} 专业智能体 | project-agent:{name} 项目 .github 智能体 | workflow:{id} 工作流 */
  automation: string;
  agentId: string;
  workflowId: string;
  /** 选中 project-agent 时的正文与显示名（由项目 .github 资产加载得到） */
  agentPrompt: string;
  agentPromptName: string;
}

/** 提交载荷：可选字段留空时省略（而非空串，否则后端 Guid?/DateTimeOffset? 绑定失败返回 400） */
export type IKanbanTaskSubmit = Omit<IKanbanTaskForm, 'dueDate' | 'projectId' | 'agentId' | 'workflowId' | 'agentPrompt' | 'agentPromptName'> & {
  dueDate?: string;
  projectId?: string;
  agentId?: string;
  workflowId?: string;
  agentPrompt?: string;
  agentPromptName?: string;
};

export interface IKanbanTaskMove {
  status: KanbanTaskStatus;
  beforeTaskId?: string | null;
  blockedReason?: string;
}

// ===== 收件箱通知 =====

export type InboxLevel = 'Info' | 'Success' | 'Warning' | 'Error';
export type InboxBatchAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'delete';

export interface IInboxNotification {
  id: string;
  category: string;
  categoryKey: string;
  level: InboxLevel;
  title: string;
  content?: string;
  isRead: boolean;
  isArchived: boolean;
  occurrenceCount: number;
  /** 点击通知跳转的应用内路径 */
  link?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IInboxCategory {
  category: string;
  totalCount: number;
  unreadCount: number;
}

export interface ICreateInboxNotificationRequest {
  category: string;
  categoryKey?: string;
  level: InboxLevel;
  title: string;
  content?: string;
}
