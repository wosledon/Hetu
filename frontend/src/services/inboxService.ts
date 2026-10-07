import { get, post, del } from './api'
import type {
  IInboxNotification,
  IInboxCategory,
  ICreateInboxNotificationRequest,
  InboxBatchAction,
} from '../types'

export const inboxService = {
  getAll: (params: { archived?: boolean; category?: string; page?: number; pageSize?: number } = {}) =>
    get<IInboxNotification[]>('/inbox', params),
  getCategories: (archived = false) =>
    get<IInboxCategory[]>('/inbox/categories', { archived }),
  getUnreadCount: () => get<number>('/inbox/unread-count'),
  create: (data: ICreateInboxNotificationRequest) => post<IInboxNotification>('/inbox', data),
  markRead: (id: string, isRead: boolean) => post<void>(`/inbox/${id}/read`, { value: isRead }),
  setArchived: (id: string, isArchived: boolean) => post<void>(`/inbox/${id}/archive`, { value: isArchived }),
  batch: (ids: string[], action: InboxBatchAction) => post<number>('/inbox/batch', { ids, action }),
  delete: (id: string) => del<void>(`/inbox/${id}`),
}
