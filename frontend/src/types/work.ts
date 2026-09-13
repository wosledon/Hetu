export interface IWorkCodeIndexStatus {
  chunkCount: number;
  fileCount: number;
  indexedAt?: string;
  isReady: boolean;
}

export interface IWorkProject {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  sessionCount: number;
  mcpServerIds: string[];
  skillIds: string[];
  diagnosticsCommand?: string;
  codeIndex: IWorkCodeIndexStatus;
  createdAt: string;
  updatedAt: string;
}

/** 工具调用权限模式：计划（只读调研）/ 只读 / 每次询问 / 自动放行写操作 / 全部放行 */
export type WorkPermissionMode = 'plan' | 'readonly' | 'ask' | 'auto' | 'bypass';

export interface IWorkSession {
  id: string;
  projectId: string;
  title: string;
  modelId?: string;
  messageCount: number;
  permissionMode: WorkPermissionMode;
  turnCount: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface IWorkApprovalRule {
  id: string;
  projectId: string;
  toolName: string;
  pathPattern?: string;
  decision: 'allow' | 'deny';
  isEnabled: boolean;
  createdAt: string;
}

export interface ICreateWorkApprovalRuleRequest {
  toolName: string;
  pathPattern?: string;
  decision: 'allow' | 'deny';
}

export interface IWorkCheckpoint {
  id: string;
  sessionId: string;
  label: string;
  tools: string;
  fileCount: number;
  files: string[];
  createdAt: string;
}

export interface IRestoreCheckpointResult {
  checkpointId: string;
  restoredCount: number;
  deletedCount: number;
  errors: string[];
}

export interface IWorkFileSearchHit {
  path: string;
  line: number;
  text: string;
}

export type WorkMessageType = 'text' | 'file_change' | 'subagent' | 'tool' | 'system';

export interface IWorkMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type: WorkMessageType;
  metadata?: string;
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  createdAt: string;
}

export interface IWorkFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface IWorkFileContent {
  path: string;
  name: string;
  size: number;
  isBinary: boolean;
  content?: string;
  modifiedAt?: string;
}

export interface IWorkFileChange {
  id: string;
  projectId: string;
  sessionId?: string;
  filePath: string;
  oldContent?: string;
  newContent: string;
  action: 'write' | 'create' | 'delete';
  createdAt: string;
}

export interface ICreateWorkProjectRequest {
  name: string;
  rootPath: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface IUpdateWorkProjectRequest {
  name: string;
  rootPath: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  mcpServerIds?: string[];
  skillIds?: string[];
  diagnosticsCommand?: string;
}

export interface ICreateWorkSessionRequest {
  projectId: string;
  title: string;
  modelId?: string;
  permissionMode?: WorkPermissionMode;
}

export interface IUpdateWorkSessionRequest {
  title: string;
  modelId?: string;
  permissionMode?: WorkPermissionMode;
}

export interface IWorkCodeSearchHit {
  path: string;
  startLine: number;
  score: number;
  snippet: string;
}

export interface IWorkCodeIndexResult {
  indexedFiles: number;
  indexedChunks: number;
  skippedFiles: number;
  removedChunks: number;
  failedFiles: number;
  indexedAt: string;
}

export interface IWorkCheckpointDiffFile {
  path: string;
  action: 'create' | 'write' | 'delete' | 'unchanged';
  oldContent?: string;
  newContent?: string;
}

export interface IWorkCheckpointDiff {
  checkpointId: string;
  label: string;
  files: IWorkCheckpointDiffFile[];
}
