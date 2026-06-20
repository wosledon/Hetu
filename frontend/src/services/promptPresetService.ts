import { get, post, put, del } from './api';
import type { IPromptPreset } from '../types';

export interface CreatePromptPresetRequest {
  category: string;
  name: string;
  content: string;
  variables?: string;
}

export interface UpdatePromptPresetRequest extends CreatePromptPresetRequest {
  sortOrder: number;
}

export const promptPresetService = {
  getAll: () => get<IPromptPreset[]>('/prompt-presets'),
  getById: (id: string) => get<IPromptPreset>(`/prompt-presets/${id}`),
  create: (data: CreatePromptPresetRequest) => post<IPromptPreset>('/prompt-presets', data),
  update: (id: string, data: UpdatePromptPresetRequest) => put<IPromptPreset>(`/prompt-presets/${id}`, data),
  delete: (id: string) => del<void>(`/prompt-presets/${id}`),
  export: () => get<IPromptPreset[]>('/prompt-presets/export'),
  import: (data: { category: string; name: string; content: string; variables?: string }[]) =>
    post<number>('/prompt-presets/import', data),
};
