import { get, post, del } from './api';
import type { IShareLink, ISharedNote } from '../types';

export const shareService = {
  create: (noteId: string, expiresInHours?: number) =>
    post<IShareLink>('/share-links', { noteId, expiresInHours }),

  getByNote: (noteId: string) =>
    get<IShareLink[]>(`/share-links/note/${noteId}`),

  deactivate: (id: string) =>
    del<void>(`/share-links/${id}`),

  getSharedNote: (shareCode: string) =>
    get<ISharedNote>(`/share/${shareCode}`),
};
