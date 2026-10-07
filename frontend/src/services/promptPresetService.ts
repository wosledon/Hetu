import { get, post, put, del } from './api';
import type { IPromptPreset, ILocalPromptPreset } from '../types';

export interface CreatePromptPresetRequest {
  category: string;
  name: string;
  content: string;
  variables?: string;
  toolsConfig?: string;
  agentType?: 'General' | 'Professional';
  subAgentIds?: string;
  modelId?: string;
  reasoningEffort?: string;
  skillIds?: string;
}

export interface UpdatePromptPresetRequest extends CreatePromptPresetRequest {
  sortOrder: number;
}

export const promptPresetService = {
  getAll: () => get<IPromptPreset[]>('/prompt-presets'),
  getById: (id: string) => get<IPromptPreset>(`/prompt-presets/${id}`),
  create: (data: CreatePromptPresetRequest) => post<IPromptPreset>('/prompt-presets', data),
  /** 从通用智能体创建专业智能体 */
  createProfessional: (id: string) => post<IPromptPreset>(`/prompt-presets/${id}/create-professional`),
  update: (id: string, data: UpdatePromptPresetRequest) => put<IPromptPreset>(`/prompt-presets/${id}`, data),
  delete: (id: string) => del<void>(`/prompt-presets/${id}`),
  export: () => get<IPromptPreset[]>('/prompt-presets/export'),
  import: (data: { category: string; name: string; content: string; variables?: string }[]) =>
    post<number>('/prompt-presets/import', data),
  getLocal: () => get<ILocalPromptPreset[]>('/prompt-presets/local'),
  getDirectories: () => get<string[]>('/prompt-presets/directories'),
  updateDirectories: (directories: string[]) => put<void>('/prompt-presets/directories', directories),
};
