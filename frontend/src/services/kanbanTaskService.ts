import { get, post, put, del } from './api';
import type { IKanbanBoard, IKanbanTask, IKanbanTaskForm, IKanbanTaskMove } from '../types';

export const kanbanTaskService = {
  getBoard: () =>
    get<IKanbanBoard>('/kanban-tasks'),

  create: (data: IKanbanTaskForm) =>
    post<IKanbanTask>('/kanban-tasks', data),

  update: (id: string, data: IKanbanTaskForm) =>
    put<IKanbanTask>(`/kanban-tasks/${id}`, data),

  move: (id: string, data: IKanbanTaskMove) =>
    put<IKanbanTask>(`/kanban-tasks/${id}/move`, data),

  delete: (id: string) =>
    del<void>(`/kanban-tasks/${id}`),
};
