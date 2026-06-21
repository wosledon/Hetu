import { get, post, put, del } from './api';
import type { INote, IPagedResult } from '../types';

export interface CreateNoteRequest {
  notebookId?: string;
  title: string;
  content: string;
}

export interface UpdateNoteRequest {
  title?: string;
  content?: string;
  notebookId?: string;
  isFavorite?: boolean;
  isPinned?: boolean;
}

export interface GetNotesRequest {
  notebookId?: string;
  tagId?: string;
  includeDeleted?: boolean;
  filterNoNotebook?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MoveNoteRequest {
  notebookId?: string;
}

export const noteService = {
  getList: (params: GetNotesRequest) => get<IPagedResult<INote>>('/notes', params as unknown as Record<string, unknown>),
  getById: (id: string) => get<INote>(`/notes/${id}`),
  create: (data: CreateNoteRequest) => post<INote>('/notes', data),
  update: (id: string, data: UpdateNoteRequest) => put<INote>(`/notes/${id}`, data),
  delete: (id: string) => del<void>(`/notes/${id}`),
  restore: (id: string) => post<void>(`/notes/${id}/restore`),
  hardDelete: (id: string) => del<void>(`/notes/${id}/hard`),
  move: (id: string, data: MoveNoteRequest) => post<void>(`/notes/${id}/move`, data),
  generateIndex: (id: string) => post<void>(`/notes/${id}/index`),
};
