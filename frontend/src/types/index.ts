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
  dataDirectory: string;
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
  purpose: 'chat' | 'embedding' | 'completion';
  isDefault: boolean;
  contextWindow?: number;
  dimensions?: number;
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
  contextWindowSize?: number;
  isArchived: boolean;
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
  createdAt: string;
}

export interface IPromptPreset {
  id: string;
  category: string;
  name: string;
  content: string;
  variables?: string;
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
