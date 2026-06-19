import { get, post, put, del } from './api';
import type { IAiProvider, IAiModel } from '../types';

export interface CreateAiProviderRequest {
  providerType: 'openai' | 'anthropic';
  name: string;
  apiKey?: string;
  baseUrl?: string;
  isEnabled?: boolean;
}

export type UpdateAiProviderRequest = CreateAiProviderRequest;

export interface CreateAiModelRequest {
  providerId: string;
  modelId: string;
  displayName: string;
  purpose: 'chat' | 'embedding' | 'completion';
  isDefault?: boolean;
  contextWindow?: number;
  dimensions?: number;
}

export interface UpdateAiModelRequest {
  modelId: string;
  displayName: string;
  purpose: 'chat' | 'embedding' | 'completion';
  isDefault?: boolean;
  contextWindow?: number;
  dimensions?: number;
}

export const aiProviderService = {
  getAll: () => get<IAiProvider[]>('/ai-providers'),
  getById: (id: string) => get<IAiProvider>(`/ai-providers/${id}`),
  create: (data: CreateAiProviderRequest) => post<IAiProvider>('/ai-providers', data),
  update: (id: string, data: UpdateAiProviderRequest) => put<IAiProvider>(`/ai-providers/${id}`, data),
  delete: (id: string) => del<void>(`/ai-providers/${id}`),
  getDefault: (purpose: string) => get<IAiProvider | null>(`/ai-providers/default/${purpose}`),
};

export const aiModelService = {
  getAll: () => get<IAiModel[]>('/ai-models'),
  getByProvider: (providerId: string) => get<IAiModel[]>(`/ai-models/provider/${providerId}`),
  getById: (id: string) => get<IAiModel>(`/ai-models/${id}`),
  create: (data: CreateAiModelRequest) => post<IAiModel>('/ai-models', data),
  update: (id: string, data: UpdateAiModelRequest) => put<IAiModel>(`/ai-models/${id}`, data),
  delete: (id: string) => del<void>(`/ai-models/${id}`),
  setDefault: (id: string) => post<void>(`/ai-models/${id}/set-default`),
};
