import { get, post, put, del } from './api'
import type {
  IScheduledTask,
  IScheduledTaskExecution,
  IScheduledTaskTargetOptions,
  ICreateScheduledTaskRequest,
  IUpdateScheduledTaskRequest,
} from '../types'

export const scheduledTaskService = {
  getAll: () => get<IScheduledTask[]>('/scheduled-tasks'),
  getById: (id: string) => get<IScheduledTask>(`/scheduled-tasks/${id}`),
  getTargetOptions: () => get<IScheduledTaskTargetOptions>('/scheduled-tasks/target-options'),
  create: (data: ICreateScheduledTaskRequest) => post<IScheduledTask>('/scheduled-tasks', data),
  update: (id: string, data: IUpdateScheduledTaskRequest) => put<IScheduledTask>(`/scheduled-tasks/${id}`, data),
  delete: (id: string) => del<void>(`/scheduled-tasks/${id}`),
  toggle: (id: string) => post<IScheduledTask>(`/scheduled-tasks/${id}/toggle`),
  runNow: (id: string) => post<IScheduledTaskExecution>(`/scheduled-tasks/${id}/run`),
  getExecutions: (id: string, limit = 50) =>
    get<IScheduledTaskExecution[]>(`/scheduled-tasks/${id}/executions`, { limit }),
}
