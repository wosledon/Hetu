import { get, post, put, del } from './api';
import type { IChatGroup, IChatTopic, IChatMessage } from '../types';

// Re-export prompt preset types and service from dedicated module
export { promptPresetService } from './promptPresetService';
export type { CreatePromptPresetRequest, UpdatePromptPresetRequest } from './promptPresetService';

export interface CreateChatGroupRequest {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface UpdateChatGroupRequest extends CreateChatGroupRequest {
  sortOrder: number;
}

export interface CreateChatTopicRequest {
  groupId: string;
  title: string;
  modelId?: string;
  customSystemPrompt?: string;
}

export interface UpdateChatTopicRequest {
  title: string;
  modelId?: string;
  customSystemPrompt?: string;
  noteSyncStatus?: string;
  isAutoOrganizeEnabled?: boolean;
  autoOrganizeNotebookId?: string;
}

export interface SendMessageRequest {
  content: string;
  deepThinking?: boolean;
  webSearch?: boolean;
  knowledgeBase?: boolean;
  memory?: boolean;
  images?: { data: string; mimeType: string; fileName?: string }[];
}

export interface IWebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface UpdateChatMessageRequest {
  content: string;
}

export interface OrganizeTopicRequest {
  notebookId?: string;
  style?: 'summary' | 'detailed' | 'qna' | 'custom';
  customPrompt?: string;
}

export const chatGroupService = {
  getAll: () => get<IChatGroup[]>('/chat-groups'),
  getById: (id: string) => get<IChatGroup>(`/chat-groups/${id}`),
  create: (data: CreateChatGroupRequest) => post<IChatGroup>('/chat-groups', data),
  update: (id: string, data: UpdateChatGroupRequest) => put<IChatGroup>(`/chat-groups/${id}`, data),
  delete: (id: string) => del<void>(`/chat-groups/${id}`),
};

export const chatTopicService = {
  getByGroup: (groupId: string) => get<IChatTopic[]>(`/chat-topics/group/${groupId}`),
  getById: (id: string) => get<IChatTopic>(`/chat-topics/${id}`),
  create: (data: CreateChatTopicRequest) => post<IChatTopic>('/chat-topics', data),
  update: (id: string, data: UpdateChatTopicRequest) => put<IChatTopic>(`/chat-topics/${id}`, data),
  delete: (id: string) => del<void>(`/chat-topics/${id}`),
  fork: (id: string, branchMessageId?: string) => {
    const params = branchMessageId ? `?branchMessageId=${branchMessageId}` : '';
    return post<IChatTopic>(`/chat-topics/${id}/fork${params}`);
  },
  organize: (id: string, data: OrganizeTopicRequest): Promise<Response> =>
    fetch(`/api/chat-topics/${id}/organize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(data),
    }),
};

export interface ChatMessageSearchResult {
  id: string;
  topicId: string;
  topicTitle: string;
  role: string;
  content: string;
  contentSnippet: string;
  createdAt: string;
}

export const chatMessageService = {
  getByTopic: (topicId: string) => get<IChatMessage[]>(`/chat-messages/topic/${topicId}`),
  send: (topicId: string, data: SendMessageRequest) => post<IChatMessage>(`/chat-messages/topic/${topicId}`, data),
  update: (id: string, data: UpdateChatMessageRequest) => put<IChatMessage>(`/chat-messages/${id}`, data),
  delete: (id: string) => del<void>(`/chat-messages/${id}`),
  stream: (topicId: string, data: SendMessageRequest): Promise<Response> =>
    fetch(`/api/chat-messages/topic/${topicId}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(data),
    }),
  search: (keyword: string, topicId?: string, groupId?: string) => {
    const params = new URLSearchParams({ keyword });
    if (topicId) params.set('topicId', topicId);
    if (groupId) params.set('groupId', groupId);
    return get<ChatMessageSearchResult[]>(`/chat-messages/search?${params.toString()}`);
  },
};
