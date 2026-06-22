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
  theme: 'light' | 'dark' | 'system';
  graphAutoExtract: string;
  autoEmbedding: string;
  defaultChatModelId?: string;
  defaultChunkModelId?: string;
  defaultFastModelId?: string;
  defaultEmbeddingModelId?: string;
  contextWindowSize?: number;
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
  purpose: 'chat' | 'embedding';
  isDefault: boolean;
  contextWindow?: number;
  dimensions?: number;
  reasoningMode: 'none' | 'tag' | 'native';
  reasoningEffort: 'off' | 'low' | 'medium' | 'high';
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
  createdAt: string;
  updatedAt: string;
}

export interface IChatMessage {
  id: string;
  topicId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parentId?: string;
  modelId?: string;
  tokensUsed?: number;
  latencyMs?: number;
  thinkingContent?: string;
  searchResultsJson?: string;
  knowledgeResultsJson?: string;
  memoryResultsJson?: string;
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
  createdAt: string;
  updatedAt: string;
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
