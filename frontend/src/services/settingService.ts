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
  getWorktreeCleanupConfig: () => get<WorktreeCleanupConfig>('/settings/worktree-cleanup'),
  setWorktreeCleanupConfig: (data: WorktreeCleanupConfig) => put<void>('/settings/worktree-cleanup', data),
  runWorktreeCleanup: () => post<WorktreeCleanupResult>('/settings/worktree-cleanup/run'),
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

/** Code 工作树自动清理配置：与后端 WorktreeCleanupConfigDto 对应 */
export interface WorktreeCleanupConfig {
  /** 自动清理开关（后台按周期执行）；手动「立即清理」不受此限制 */
  enabled: boolean;
  /** 自动检查间隔（小时） */
  intervalHours: number;
  /** 工作树空闲多久（小时）后才允许自动清理 */
  idleHours: number;
  /** 清理已合并工作树时是否连带删除本地分支 */
  deleteMergedBranch: boolean;
  /** 最近一次执行时间（只读） */
  lastRunAt?: string;
  /** 最近一次清理的数量（只读） */
  lastRemoved?: number;
}

/** 工作树清理结果 */
export interface WorktreeCleanupResult {
  removed: number;
  checked: number;
  kept: number;
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
