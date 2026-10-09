import { get, post, put, del } from './api';
import type {
  IWorkProject,
  IWorkSession,
  IWorkMessage,
  IWorkFileEntry,
  IWorkFileContent,
  IWorkFileChange,
  IWorkApprovalRule,
  ICreateWorkApprovalRuleRequest,
  IWorkCheckpoint,
  IRestoreCheckpointResult,
  IWorkFileSearchHit,
  IWorkCodeIndexStatus,
  IWorkCodeIndexResult,
  IWorkCodeSearchHit,
  IWorkCheckpointDiff,
  ICreateWorkProjectRequest,
  IUpdateWorkProjectRequest,
  ICreateWorkSessionRequest,
  IUpdateWorkSessionRequest,
  IWorkGitStatus,
  IWorkGitFileContent,
  IWorkOpenApp,
  IWorkCopilotAssets,
  WorkPermissionMode,
} from '../types/work';

export const workProjectService = {
  getAll: () => get<IWorkProject[]>('/work-projects'),
  getById: (id: string) => get<IWorkProject>(`/work-projects/${id}`),
  create: (data: ICreateWorkProjectRequest) => post<IWorkProject>('/work-projects', data),
  update: (id: string, data: IUpdateWorkProjectRequest) => put<IWorkProject>(`/work-projects/${id}`, data),
  delete: (id: string) => del<void>(`/work-projects/${id}`),
  getSessions: (id: string, query?: string) =>
    get<IWorkSession[]>(`/work-projects/${id}/sessions`, { query: query || undefined }),
  getApprovalRules: (id: string) => get<IWorkApprovalRule[]>(`/work-projects/${id}/approval-rules`),
  /** 用外部应用打开项目目录：vscode / cursor / explorer / terminal */
  open: (id: string, app: string) =>
    post<string>(`/work-projects/${id}/open?app=${app}`),
  createApprovalRule: (id: string, data: ICreateWorkApprovalRuleRequest) =>
    post<IWorkApprovalRule>(`/work-projects/${id}/approval-rules`, data),
  deleteApprovalRule: (id: string) => del<void>(`/work-approval-rules/${id}`),
  /** 代码语义索引状态 */
  getCodeIndexStatus: (id: string) => get<IWorkCodeIndexStatus>(`/work-projects/${id}/code-index`),
  /** 建立/重建代码语义索引 */
  indexCode: (id: string, force = false) =>
    post<IWorkCodeIndexResult>(`/work-projects/${id}/code-index?force=${force ? 'true' : 'false'}`),
  clearCodeIndex: (id: string) => del<void>(`/work-projects/${id}/code-index`),
  /** 代码语义检索（需先建立索引） */
  searchCode: (id: string, query: string, limit = 8) =>
    get<IWorkCodeSearchHit[]>(`/work-projects/${id}/code-index/search`, { query, limit }),
  /** GitHub Copilot 资产：.github 下的指令 / 智能体 / 提示词 / 技能（自动加载） */
  getCopilotAssets: (id: string) => get<IWorkCopilotAssets>(`/work-projects/${id}/copilot-assets`),
};

export const workSessionService = {
  getById: (id: string) => get<IWorkSession>(`/work-sessions/${id}`),
  create: (data: ICreateWorkSessionRequest) => post<IWorkSession>('/work-sessions', data),
  update: (id: string, data: IUpdateWorkSessionRequest) => put<IWorkSession>(`/work-sessions/${id}`, data),
  delete: (id: string) => del<void>(`/work-sessions/${id}`),
  getMessages: (id: string) => get<IWorkMessage[]>(`/work-sessions/${id}/messages`),
  /** 编辑消息正文（与对话页一致的复制/编辑/删除） */
  updateMessage: (messageId: string, content: string) =>
    put<IWorkMessage>(`/work-sessions/messages/${messageId}`, { content }),
  deleteMessage: (messageId: string) => del<void>(`/work-sessions/messages/${messageId}`),
  getFileChanges: (id: string) => get<IWorkFileChange[]>(`/work-sessions/${id}/file-changes`),
  getCheckpoints: (id: string) => get<IWorkCheckpoint[]>(`/work-sessions/${id}/checkpoints`),
  addMessage: (id: string, data: { role: string; content: string; type?: string; metadata?: string }) =>
    post<IWorkMessage>(`/work-sessions/${id}/messages`, data),
  /** 流式发起一轮工作对话，返回待消费的 SSE 响应 */
  stream: (
    id: string,
    data: {
      content: string;
      modelId?: string;
      enableTools?: boolean;
      toolApprovalMode?: string;
      permissionMode?: WorkPermissionMode;
      reasoningEffort?: string;
      agentPrompt?: string;
      /** /prompt 模板：.github/prompts 下的文件相对路径 */
      promptFile?: string;
      /** /skill 命令选择的技能名称 */
      skillName?: string;
      /** 输入框 @ 引用的内容（type: note | notebook | tag | knowledge） */
      mentions?: { type: string; id: string }[];
      /** 网络搜索 / 知识库 / 记忆 / 深度思考：与对话会话共用同一套开关语义 */
      webSearch?: boolean;
      knowledgeBase?: boolean;
      memory?: boolean;
      deepThinking?: boolean;
      /** 会话级上下文上限（token），空 = 模型支持的上限 */
      contextWindow?: number;
      /** 图片附件（视觉模型多模态输入） */
      images?: { data: string; mimeType: string; fileName?: string }[];
      persistUserMessage?: boolean;
    },
    signal?: AbortSignal,
  ) =>
    fetch(`/api/work-sessions/${id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(data),
      signal,
    }),
  /** 工具审批：同意或拒绝等待中的写操作 */
  approve: (sessionId: string, toolCallId: string, approve: boolean) =>
    post<void>('/chat-messages/approve', { sessionId, toolCallId, approve }),
  /** 回答 Agent 的追问 */
  answer: (sessionId: string, toolCallId: string, answer: string) =>
    post<void>('/chat-messages/answer', { sessionId, toolCallId, answer }),
};

export const workCheckpointService = {
  restore: (id: string) => post<IRestoreCheckpointResult>(`/work-checkpoints/${id}/restore`),
  diff: (id: string) => get<IWorkCheckpointDiff>(`/work-checkpoints/${id}/diff`),
  delete: (id: string) => del<void>(`/work-checkpoints/${id}`),
};

export const workTerminalService = {
  /** 结束当前终端会话，下次连接会启动新进程 */
  stop: (projectId: string) => post<void>(`/work-terminal/${projectId}/stop`),
};

/** SSH 客户端探测与连接测试 */
export interface ISshStatus {
  available: boolean
  version?: string
  os: string
  installHint: string
  installUrl?: string
}

export interface ISshTestRequest {
  name?: string
  host: string
  port: number
  user?: string
  authType: string
  keyPath?: string
  password?: string
  rootPath?: string
}

export interface ISshTestResult {
  success: boolean
  message: string
  remoteBanner?: string
}

/** 目录列举（本地 / 远程通用） */
export interface IDirListing {
  current: string
  parent?: string | null
  entries: { name: string; isDirectory: boolean }[]
}

/** 本机 SSH 配置中的主机条目 */
export interface ISshConfigHost {
  alias: string
  hostName?: string
  user?: string
  port: number
  identityFile?: string
}

export interface ISshBrowseRequest {
  host: string
  port: number
  user?: string
  authType?: string
  keyPath?: string
  password?: string
  path?: string
}

export const workSshService = {
  status: () => get<ISshStatus>('/work/ssh/status'),
  test: (data: ISshTestRequest) => post<ISshTestResult>('/work/ssh/test', data),
  /** 本机 SSH 配置主机列表（~/.ssh/config） */
  configHosts: () => get<ISshConfigHost[]>('/work/ssh/hosts'),
  /** 远程目录列举 */
  remoteDirs: (data: ISshBrowseRequest) => post<IDirListing>('/work/ssh/dirs', data),
};

export const workBrowseService = {
  /** 本地目录列举；path 为空返回盘符 / 主目录 */
  localDirs: (path?: string) => get<IDirListing>('/work/local/dirs', { path }),
};

export const workOpenService = {
  apps: () => get<IWorkOpenApp[]>('/work-open/apps'),
};

export const workGitService = {
  status: (projectId: string) => get<IWorkGitStatus>(`/work-projects/${projectId}/git/status`),
  fileContent: (projectId: string, path: string) =>
    get<IWorkGitFileContent>(`/work-projects/${projectId}/git/file`, { path }),
  commit: (projectId: string, message: string, paths: string[]) =>
    post<{ success: boolean; output: string }>(`/work-projects/${projectId}/git/commit`, { message, paths }),
};

export const workFileService = {
  list: (projectId: string, path?: string) =>
    get<IWorkFileEntry[]>(`/work-projects/${projectId}/fs/list`, { path: path || undefined }),
  read: (projectId: string, path: string) =>
    get<IWorkFileContent>(`/work-projects/${projectId}/fs/read`, { path }),
  search: (projectId: string, query: string, limit?: number) =>
    get<IWorkFileSearchHit[]>(`/work-projects/${projectId}/fs/search`, { query, limit }),
  write: (projectId: string, path: string, content: string, originalContent?: string) =>
    put<IWorkFileContent>(`/work-projects/${projectId}/fs/write`, { path, content, originalContent }),
};

export const workTerminalUrl = (projectId: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || 'localhost';
  // 开发模式下后端运行在 5000 端口
  const port = import.meta.env.DEV ? ':5000' : window.location.port ? `:${window.location.port}` : '';
  return `${protocol}//${host}${port}/api/work-terminal/${projectId}/connect`;
};
