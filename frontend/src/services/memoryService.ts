import { get, post, put, del } from './api';
import type { IMemory, IPagedResult, IDreamResult, MemoryScope } from '../types';

export const memoryService = {
  getAll: (page = 1, pageSize = 50, scope?: MemoryScope) =>
    get<IPagedResult<IMemory>>('/memories', { page, pageSize, ...(scope ? { scope } : {}) }),

  search: (query: string, topK = 10) =>
    post<IMemory[]>('/memories/search', { query, topK }),

  create: (data: { content: string; category?: string; importance?: number; scope?: MemoryScope; projectId?: string }) =>
    post<IMemory>('/memories', data),

  update: (id: string, data: { content: string; category?: string; importance: number; scope?: MemoryScope; projectId?: string }) =>
    put<IMemory>(`/memories/${id}`, data),

  delete: (id: string) =>
    del<void>(`/memories/${id}`),

  extract: (topicId: string) =>
    post<IMemory[]>(`/memories/extract/${topicId}`),

  /** 手动执行一次 Dream 记忆巩固（合并 / 衰减 / 遗忘），返回统计 */
  dream: () => post<IDreamResult>('/memories/dream', {}),
};
