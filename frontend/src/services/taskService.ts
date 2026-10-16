import { get, del } from './api'
import type { ITaskItem, ITaskStats, IPagedResult } from '../types'

export const taskService = {
  getAll: (params?: { type?: string; status?: number; page?: number; pageSize?: number }) =>
    get<IPagedResult<ITaskItem>>('/task-items', params as Record<string, unknown>),
  getStats: () => get<ITaskStats>('/task-items/stats'),
  delete: (id: string) => del(`/task-items/${id}`),
  clearCompleted: () => del('/task-items/completed'),
}
