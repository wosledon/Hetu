import { get, post, put, del } from './api';
import type { INotebook } from '../types';

export interface CreateNotebookRequest {
  parentId?: string;
  name: string;
}

export interface UpdateNotebookRequest {
  name: string;
  parentId?: string;
  sortOrder: number;
}

export const notebookService = {
  getTree: () => get<INotebook[]>('/notebooks'),
  getById: (id: string) => get<INotebook>(`/notebooks/${id}`),
  create: (data: CreateNotebookRequest) => post<INotebook>('/notebooks', data),
  update: (id: string, data: UpdateNotebookRequest) => put<INotebook>(`/notebooks/${id}`, data),
  delete: (id: string) => del<void>(`/notebooks/${id}`),
};
