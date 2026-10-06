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
  reasoningMode?: string;
  reasoningEffort?: string;
  reasoningBudgetTokens?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsTools?: boolean;
  isVisible?: boolean;
}

export interface UpdateAiModelRequest {
  modelId: string;
  displayName: string;
  purpose: 'chat' | 'embedding' | 'completion';
  isDefault?: boolean;
  contextWindow?: number;
  dimensions?: number;
  reasoningMode?: string;
  reasoningEffort?: string;
  reasoningBudgetTokens?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsTools?: boolean;
  isVisible?: boolean;
}

export interface RemoteModelInfo {
  modelId: string;
  displayName?: string;
  contextWindow?: number;
}

/** models.dev 模型目录条目（添加模型时自动填充能力配置） */
export interface CatalogModelInfo {
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  description?: string;
  family?: string;
  reasoning: boolean;
  /** 模型支持的推理强度等级（effort 类型） */
  reasoningEffortValues: string[];
  /** 推理 Token 预算下限（budget_tokens 类型，Claude 风格） */
  reasoningBudgetMin?: number;
  /** 推理仅支持开关切换（toggle 类型） */
  reasoningToggleOnly: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  releaseDate?: string;
}

/** models.dev 供应商信息（添加供应商时只需填 API Key） */
export interface CatalogProviderInfo {
  id: string;
  name: string;
  /** 官方 API 地址（未提供时需手动填写） */
  api?: string;
  /** 官方环境变量名，如 DEEPSEEK_API_KEY */
  env?: string;
  /** SDK 包名，用于推断 OpenAI 兼容 / Anthropic 协议 */
  npm?: string;
  doc?: string;
  modelCount: number;
}

/** models.dev 供应商详情（含全部模型） */
export interface CatalogProviderDetail extends CatalogProviderInfo {
  models: CatalogModelInfo[];
}

export interface CatalogProviderInfo {
  id: string;
  name: string;
  modelCount: number;
}

export const aiProviderService = {
  getAll: () => get<IAiProvider[]>('/ai-providers'),
  getById: (id: string) => get<IAiProvider>(`/ai-providers/${id}`),
  create: (data: CreateAiProviderRequest) => post<IAiProvider>('/ai-providers', data),
  update: (id: string, data: UpdateAiProviderRequest) => put<IAiProvider>(`/ai-providers/${id}`, data),
  delete: (id: string) => del<void>(`/ai-providers/${id}`),
  getDefault: (purpose: string) => get<IAiProvider | null>(`/ai-providers/default/${purpose}`),
  fetchModels: (id: string) => get<RemoteModelInfo[]>(`/ai-providers/${id}/fetch-models`),
};

/** 模型目录（models.dev）检索：添加模型时自动填充能力配置 */
export const aiModelCatalogService = {
  search: (q: string, limit = 30) =>
    get<CatalogModelInfo[]>(`/ai-models/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  providers: () => get<CatalogProviderInfo[]>('/ai-models/catalog/providers'),
  searchProviders: (q: string, limit = 20) =>
    get<CatalogProviderInfo[]>(`/ai-models/catalog/providers/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  provider: (id: string) => get<CatalogProviderDetail>(`/ai-models/catalog/providers/${encodeURIComponent(id)}`),
};

export const aiModelService = {
  getAll: () => get<IAiModel[]>('/ai-models'),
  getByProvider: (providerId: string) => get<IAiModel[]>(`/ai-models/provider/${providerId}`),
  getById: (id: string) => get<IAiModel>(`/ai-models/${id}`),
  create: (data: CreateAiModelRequest) => post<IAiModel>('/ai-models', data),
  createBatch: (data: CreateAiModelRequest[]) => post<IAiModel[]>('/ai-models/batch', data),
  update: (id: string, data: UpdateAiModelRequest) => put<IAiModel>(`/ai-models/${id}`, data),
  delete: (id: string) => del<void>(`/ai-models/${id}`),
  setDefault: (id: string) => post<void>(`/ai-models/${id}/set-default`),
};
