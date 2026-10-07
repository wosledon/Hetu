import { get, post, put, del } from './api';
import type {
  IKanbanBoard, IKanbanTask, IKanbanTaskForm, IKanbanTaskMove, IKanbanTaskDetail,
} from '../types';

export const kanbanTaskService = {
  getBoard: () =>
    get<IKanbanBoard>('/kanban-tasks'),

  getDetail: (id: string) =>
    get<IKanbanTaskDetail>(`/kanban-tasks/${id}/detail`),

  create: (data: IKanbanTaskForm) =>
    post<IKanbanTask>('/kanban-tasks', data),

  update: (id: string, data: IKanbanTaskForm) =>
    put<IKanbanTask>(`/kanban-tasks/${id}`, data),

  move: (id: string, data: IKanbanTaskMove) =>
    put<IKanbanTask>(`/kanban-tasks/${id}/move`, data),

  /** 提交评论；审核中/已阻塞且配置了自动处理时任务回到进行中并重新处理 */
  addComment: (id: string, data: { content: string; triggerAutomation?: boolean }) =>
    post<IKanbanTaskDetail>(`/kanban-tasks/${id}/comments`, data),

  /** 手动重新触发一次执行 */
  rerun: (id: string) =>
    post<IKanbanTask>(`/kanban-tasks/${id}/rerun`, {}),

  delete: (id: string) =>
    del<void>(`/kanban-tasks/${id}`),
};
