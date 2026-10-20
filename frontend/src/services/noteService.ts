import { get, post, put, del } from './api';
import type { INote, IPagedResult } from '../types';

export interface CreateNoteRequest {
  /** 父笔记 Id；为空表示根级笔记 */
  parentId?: string;
  title: string;
  content: string;
  /** 笔记图标（emoji） */
  icon?: string;
}

export interface UpdateNoteRequest {
  title?: string;
  content?: string;
  parentId?: string;
  icon?: string;
  isFavorite?: boolean;
  isPinned?: boolean;
}

export interface GetNotesRequest {
  /** 父笔记 Id；为空且 filterRoot 为 false 时返回全部笔记 */
  parentId?: string;
  /** 只返回根级笔记 */
  filterRoot?: boolean;
  tagId?: string;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MoveNoteRequest {
  /** 目标父笔记 Id；为空表示移到根级 */
  parentId?: string;
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
