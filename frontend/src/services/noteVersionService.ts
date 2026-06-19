import { get, post } from './api';
import type { INoteVersion, INote } from '../types';

export const noteVersionService = {
  getVersions: (noteId: string) => get<INoteVersion[]>(`/notes/${noteId}/versions`),
  getById: (noteId: string, id: string) => get<INoteVersion>(`/notes/${noteId}/versions/${id}`),
  restore: (noteId: string, id: string) => post<INote>(`/notes/${noteId}/versions/${id}/restore`),
};
