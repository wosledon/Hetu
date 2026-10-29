import { get, post, put, del } from './api';
import type { IPagedResult } from '../types';
import type { IWhiteboard, IWhiteboardListItem, IWhiteboardSubmit } from '../types/whiteboard';

export const whiteboardService = {
  list: (page = 1, pageSize = 100) =>
    get<IPagedResult<IWhiteboardListItem>>('/whiteboards', { page, pageSize }),

  get: (id: string) =>
    get<IWhiteboard>(`/whiteboards/${id}`),

  create: (data: IWhiteboardSubmit) =>
    post<IWhiteboard>('/whiteboards', data),

  update: (id: string, data: { name?: string; scene?: string }) =>
    put<IWhiteboard>(`/whiteboards/${id}`, data),

  remove: (id: string) =>
    del<void>(`/whiteboards/${id}`),
};
