import { get, post, put, patch, del } from './api'
import type { ITaskItem, ITaskStats } from '../types'

export const taskService = {
  getAll: () => get<ITaskItem[]>('/task-items'),
  getById: (id: string) => get<ITaskItem>(`/task-items/${id}`),
  create: (data: Omit<ITaskItem, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>) =>
    post<ITaskItem>('/task-items', data),
  update: (id: string, data: Omit<ITaskItem, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>) =>
    put<ITaskItem>(`/task-items/${id}`, data),
  updateStatus: (id: string, status: number) =>
    patch<ITaskItem>(`/task-items/${id}/status`, { status }),
  updateProgress: (id: string, progress: number) =>
    patch<ITaskItem>(`/task-items/${id}/progress`, { progress }),
  delete: (id: string) => del(`/task-items/${id}`),
  getStats: () => get<ITaskStats>('/task-items/stats'),
}
