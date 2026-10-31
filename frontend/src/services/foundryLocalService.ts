import { get, post, put, del } from './api';
import { consumeSseStream, SSE_ERROR_PREFIX } from '../utils/sse';

/** Foundry Local 运行时状态 */
export interface FoundryLocalStatus {
  /** 当前平台是否支持（原生库在位） */
  supported: boolean;
  /** 不支持时的原因（后端已本地化） */
  unsupportedReason?: string;
  /** 本地 OpenAI 兼容服务是否在监听 */
  running: boolean;
  /** OpenAI 兼容端点 */
  endpoint?: string;
  /** 当前生效的模型保存路径 */
  modelDir?: string;
  /** 未配置时的默认保存路径 */
  defaultModelDir?: string;
  /** 已保存但尚未生效的路径（重启后生效）；与生效路径相同时为空 */
  pendingModelDir?: string;
  loadedCount: number;
  cachedCount: number;
  /** 改了保存路径但尚未生效，需要重启 Hetu */
  restartRequired: boolean;
}

/** Foundry Local 目录中的一个模型 */
export interface FoundryLocalModel {
  alias: string;
  id: string;
  displayName?: string;
  publisher?: string;
  modelType?: string;
  task?: string;
  license?: string;
  uri?: string;
  fileSizeMb?: number;
  contextLength?: number;
  maxOutputTokens?: number;
  supportsToolCalling: boolean;
  supportsReasoning: boolean;
  /** 输入模态（逗号分隔，如 text,image） */
  inputModalities?: string;
  /** 输出模态（逗号分隔） */
  outputModalities?: string;
  deviceType?: string;
  executionProvider?: string;
  isCached: boolean;
  isLoaded: boolean;
  variants: string[];
  /** 是否已注册为 Hetu 的 Provider 模型 */
  isRegistered: boolean;
}

export interface FoundryLocalDownloadProgress {
  alias: string;
  /** 百分比 0~100 */
  progress?: number;
  state: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export const foundryLocalService = {
  getStatus: () => get<FoundryLocalStatus>('/foundry-local/status'),
  getModels: (cachedOnly = false) =>
    get<FoundryLocalModel[]>(`/foundry-local/models?cachedOnly=${cachedOnly}`),
  getLoadedModels: () => get<FoundryLocalModel[]>('/foundry-local/models/loaded'),
  register: (alias: string, purpose: 'chat' | 'embedding' = 'chat') =>
    post<string>(`/foundry-local/models/${encodeURIComponent(alias)}/register?purpose=${purpose}`),
  load: (alias: string) =>
    post<void>(`/foundry-local/models/${encodeURIComponent(alias)}/load`),
  unload: (alias: string) =>
    post<void>(`/foundry-local/models/${encodeURIComponent(alias)}/unload`),
  remove: (alias: string) =>
    del<void>(`/foundry-local/models/${encodeURIComponent(alias)}`),
  startService: () => post<void>('/foundry-local/service/start'),
  stopService: () => post<void>('/foundry-local/service/stop'),
  setModelDir: (path: string | null) =>
    put<string>('/foundry-local/model-dir', { path: path ?? '' }),

  /**
   * 下载模型：后端走 SSE 推进度（data: {alias,progress,state,error}），
   * 这里手工 fetch 而不是走 axios 拦截器——拦截器要求统一响应结构，而 SSE 帧不是。
   */
  download: async (
    alias: string,
    onProgress: (progress: FoundryLocalDownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const response = await fetch(`/api/foundry-local/models/${encodeURIComponent(alias)}/download`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || `download failed: ${response.status}`)
    }
    await consumeSseStream(response, ({ data }) => {
      if (!data || data.startsWith(SSE_ERROR_PREFIX)) {
        onProgress({ alias, state: 'failed', error: data.replace(SSE_ERROR_PREFIX, '').trim() })
        return
      }
      try {
        onProgress(JSON.parse(data) as FoundryLocalDownloadProgress)
      } catch {
        // 非 JSON 帧（心跳等）忽略
      }
    }, { signal })
  },
};
