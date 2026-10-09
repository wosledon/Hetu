import { get, put, post } from './api';
import type { IAppSettingsSnapshot } from '../types';

export interface UpdateAppSettingRequest {
  key: string;
  value?: string;
}

export interface TestDatabaseRequest {
  provider: 'Sqlite' | 'Postgresql';
  connectionString: string;
}

export interface TestDatabaseResult {
  canConnect: boolean;
  vectorExtensionAvailable: boolean;
  message?: string;
}

export const settingService = {
  getSnapshot: () => get<IAppSettingsSnapshot>('/settings'),
  set: (data: UpdateAppSettingRequest) => put<void>('/settings', data),
  testDatabase: (data: TestDatabaseRequest) => post<TestDatabaseResult>('/settings/test-database', data),
  getCompressionConfig: () => get<CompressionPipelineConfig>('/settings/compression'),
  setCompressionConfig: (data: CompressionPipelineConfig) => put<void>('/settings/compression', data),
};

export interface CompressionPipelineConfig {
  enabled: boolean;
  mode: string; // algorithmic | llm | hybrid
  llmModelId?: string;
  llmSystemPrompt?: string;
  /** LLM 摘要触发阈值（字符）：算法节点不限长度，LLM 摘要按此阈值触发 */
  llmThreshold?: number;
  nodes: CompressionNodeConfig[];
}

export interface CompressionNodeConfig {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  order: number;
}
