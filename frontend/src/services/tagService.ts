import { get, post, put, del } from './api';
import type { ITag } from '../types';

export interface CreateTagRequest {
  name: string;
  color?: string;
}

export interface UpdateTagRequest {
  name: string;
  color?: string;
}

export interface ManageNoteTagsRequest {
  tagIds: string[];
}

export interface MergeTagsRequest {
  sourceTagIds: string[];
  targetTagId: string;
}

export const tagService = {
  getAll: () => get<ITag[]>('/tags'),
  getById: (id: string) => get<ITag>(`/tags/${id}`),
  create: (data: CreateTagRequest) => post<ITag>('/tags', data),
  update: (id: string, data: UpdateTagRequest) => put<ITag>(`/tags/${id}`, data),
  delete: (id: string) => del<void>(`/tags/${id}`),
  merge: (data: MergeTagsRequest) => post<void>('/tags/merge', data),
  getByNote: (noteId: string) => get<ITag[]>(`/tags/note/${noteId}`),
  setNoteTags: (noteId: string, data: ManageNoteTagsRequest) => put<void>(`/tags/note/${noteId}`, data),
};
