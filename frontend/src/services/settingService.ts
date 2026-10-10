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

  getDreamConfig: () => get<DreamConfig>('/settings/dream'),
  setDreamConfig: (data: DreamConfig) => put<void>('/settings/dream', data),
};

/** Dream（记忆巩固）配置：与后端 DreamConfigDto 对应 */
export interface DreamConfig {
  /** 自动 Dream 开关（后台按周期执行） */
  enabled: boolean;
  /** 自动执行间隔（小时） */
  intervalHours: number;
  /** 合并阈值：相似度 ≥ 该值的记忆合并 */
  mergeThreshold: number;
  /** 超过该天数未想起 → 重要性衰减 */
  decayDays: number;
  /** 超过该天数未想起且重要性过低 → 遗忘清除 */
  forgetDays: number;
  forgetBelowImportance: number;
  /** 最近一次执行时间（只读） */
  lastRunAt?: string;
}

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
