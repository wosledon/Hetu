export interface IWorkCodeIndexStatus {
  chunkCount: number;
  fileCount: number;
  indexedAt?: string;
  isReady: boolean;
  staleFileCount: number;
  isStale: boolean;
  refreshPending: boolean;
}

export interface IWorkProject {
  id: string;
  name: string;
  rootPath: string;
  /** 连接类型：Local | Ssh */
  connectionType: string;
  sshHost?: string;
  sshPort: number;
  sshUser?: string;
  /** Key | Password | Agent */
  sshAuthType: string;
  sshKeyPath?: string;
  hasSshPassword: boolean;
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

export type WorkMessageType = 'text' | 'file_change' | 'subagent' | 'tool' | 'thought' | 'checkpoint' | 'system';

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
  connectionType?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthType?: string;
  sshKeyPath?: string;
  sshPassword?: string;
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
  connectionType?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthType?: string;
  sshKeyPath?: string;
  sshPassword?: string;
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

export interface IWorkOpenApp {
  app: string;
  label: string;
  available: boolean;
  iconUrl?: string;
}

/** GitHub Copilot 资产：项目 .github 目录自动加载的指令/智能体/提示词/技能 */
export interface IWorkCopilotAgent {
  /** 形如 copilot:{name}，避免与提示词预设 ID 冲突 */
  id: string;
  name: string;
  description: string;
  /** 人设正文，选中该 Agent 时作为 agentPrompt 下发 */
  content: string;
}

export interface IWorkCopilotAssetItem {
  name: string;
  description: string;
  filePath: string;
}

export interface IWorkCopilotAssets {
  agents: IWorkCopilotAgent[];
  prompts: IWorkCopilotAssetItem[];
  skills: IWorkCopilotAssetItem[];
  instructions: IWorkCopilotAssetItem[];
  hasAssets: boolean;
}

export interface IWorkGitFileStatus {
  path: string;
  /** M 修改 / A 新增 / D 删除 / R 重命名 / ?? 未跟踪 */
  status: string;
}

export interface IWorkGitStatus {
  isRepo: boolean;
  branch: string;
  files: IWorkGitFileStatus[];
}

export interface IWorkGitFileContent {
  path: string;
  status: string;
  oldContent?: string;
  newContent?: string;
  isBinary: boolean;
}

export interface IWorkCheckpointDiffFile {
  path: string;
  action: 'create' | 'write' | 'delete' | 'unchanged' | 'skipped';
  oldContent?: string;
  newContent?: string;
  truncated: boolean;
  isBinary: boolean;
  note?: string;
}

export interface IWorkCheckpointDiff {
  checkpointId: string;
  label: string;
  files: IWorkCheckpointDiffFile[];
  totalFiles: number;
  truncated: boolean;
}
