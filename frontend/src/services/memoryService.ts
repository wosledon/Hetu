import { get, post, put, del } from './api';
import type { IMemory, IPagedResult } from '../types';

export const memoryService = {
  getAll: (page = 1, pageSize = 50) =>
    get<IPagedResult<IMemory>>('/memories', { page, pageSize }),

  search: (query: string, topK = 10) =>
    post<IMemory[]>('/memories/search', { query, topK }),

  create: (data: { content: string; category?: string; importance?: number }) =>
    post<IMemory>('/memories', data),

  update: (id: string, data: { content: string; category?: string; importance: number }) =>
    put<IMemory>(`/memories/${id}`, data),

  delete: (id: string) =>
    del<void>(`/memories/${id}`),

  extract: (topicId: string) =>
    post<IMemory[]>(`/memories/extract/${topicId}`),
};
