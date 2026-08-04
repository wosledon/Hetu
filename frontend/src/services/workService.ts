import { get, post, put, del } from './api';
import type {
  IWorkProject,
  IWorkSession,
  IWorkMessage,
  IWorkFileEntry,
  IWorkFileContent,
  IWorkFileChange,
  ICreateWorkProjectRequest,
  IUpdateWorkProjectRequest,
  ICreateWorkSessionRequest,
  IUpdateWorkSessionRequest,
} from '../types/work';

export const workProjectService = {
  getAll: () => get<IWorkProject[]>('/work-projects'),
  getById: (id: string) => get<IWorkProject>(`/work-projects/${id}`),
  create: (data: ICreateWorkProjectRequest) => post<IWorkProject>('/work-projects', data),
  update: (id: string, data: IUpdateWorkProjectRequest) => put<IWorkProject>(`/work-projects/${id}`, data),
  delete: (id: string) => del<void>(`/work-projects/${id}`),
  getSessions: (id: string) => get<IWorkSession[]>(`/work-projects/${id}/sessions`),
};

export const workSessionService = {
  getById: (id: string) => get<IWorkSession>(`/work-sessions/${id}`),
  create: (data: ICreateWorkSessionRequest) => post<IWorkSession>('/work-sessions', data),
  update: (id: string, data: IUpdateWorkSessionRequest) => put<IWorkSession>(`/work-sessions/${id}`, data),
  delete: (id: string) => del<void>(`/work-sessions/${id}`),
  getMessages: (id: string) => get<IWorkMessage[]>(`/work-sessions/${id}/messages`),
  getFileChanges: (id: string) => get<IWorkFileChange[]>(`/work-sessions/${id}/file-changes`),
  addMessage: (id: string, data: { role: string; content: string; type?: string; metadata?: string }) =>
    post<IWorkMessage>(`/work-sessions/${id}/messages`, data),
};

export const workFileService = {
  list: (projectId: string, path?: string) =>
    get<IWorkFileEntry[]>(`/work-projects/${projectId}/fs/list`, { path: path || undefined }),
  read: (projectId: string, path: string) =>
    get<IWorkFileContent>(`/work-projects/${projectId}/fs/read`, { path }),
};

export const workTerminalUrl = (projectId: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || 'localhost';
  // 开发模式下后端运行在 5000 端口
  const port = import.meta.env.DEV ? ':5000' : window.location.port ? `:${window.location.port}` : '';
  return `${protocol}//${host}${port}/api/work-terminal/${projectId}/connect`;
};
