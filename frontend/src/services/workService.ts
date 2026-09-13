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
  ICreateWorkProjectRequest,
  IUpdateWorkProjectRequest,
  ICreateWorkSessionRequest,
  IUpdateWorkSessionRequest,
  WorkPermissionMode,
} from '../types/work';

export const workProjectService = {
  getAll: () => get<IWorkProject[]>('/work-projects'),
  getById: (id: string) => get<IWorkProject>(`/work-projects/${id}`),
  create: (data: ICreateWorkProjectRequest) => post<IWorkProject>('/work-projects', data),
  update: (id: string, data: IUpdateWorkProjectRequest) => put<IWorkProject>(`/work-projects/${id}`, data),
  delete: (id: string) => del<void>(`/work-projects/${id}`),
  getSessions: (id: string) => get<IWorkSession[]>(`/work-projects/${id}/sessions`),
  getApprovalRules: (id: string) => get<IWorkApprovalRule[]>(`/work-projects/${id}/approval-rules`),
  createApprovalRule: (id: string, data: ICreateWorkApprovalRuleRequest) =>
    post<IWorkApprovalRule>(`/work-projects/${id}/approval-rules`, data),
  deleteApprovalRule: (id: string) => del<void>(`/work-approval-rules/${id}`),
};

export const workSessionService = {
  getById: (id: string) => get<IWorkSession>(`/work-sessions/${id}`),
  create: (data: ICreateWorkSessionRequest) => post<IWorkSession>('/work-sessions', data),
  update: (id: string, data: IUpdateWorkSessionRequest) => put<IWorkSession>(`/work-sessions/${id}`, data),
  delete: (id: string) => del<void>(`/work-sessions/${id}`),
  getMessages: (id: string) => get<IWorkMessage[]>(`/work-sessions/${id}/messages`),
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
  delete: (id: string) => del<void>(`/work-checkpoints/${id}`),
};

export const workTerminalService = {
  /** 结束当前终端会话，下次连接会启动新进程 */
  stop: (projectId: string) => post<void>(`/work-terminal/${projectId}/stop`),
};

export const workFileService = {
  list: (projectId: string, path?: string) =>
    get<IWorkFileEntry[]>(`/work-projects/${projectId}/fs/list`, { path: path || undefined }),
  read: (projectId: string, path: string) =>
    get<IWorkFileContent>(`/work-projects/${projectId}/fs/read`, { path }),
  search: (projectId: string, query: string, limit?: number) =>
    get<IWorkFileSearchHit[]>(`/work-projects/${projectId}/fs/search`, { query, limit }),
};

export const workTerminalUrl = (projectId: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || 'localhost';
  // 开发模式下后端运行在 5000 端口
  const port = import.meta.env.DEV ? ':5000' : window.location.port ? `:${window.location.port}` : '';
  return `${protocol}//${host}${port}/api/work-terminal/${projectId}/connect`;
};
