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
  /** 可用的执行提供程序；未注册的 EP 对应设备不会出现在模型目录里 */
  executionProviders: FoundryLocalEp[];
  /** 改了保存路径但尚未生效，需要重启 Hetu */
  restartRequired: boolean;
}

/** 执行提供程序（决定目录里出现哪些设备的模型） */
export interface FoundryLocalEp {
  name: string;
  /** CPU / GPU / NPU / Unknown */
  deviceType: string;
  isRegistered: boolean;
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
  /** 该变体的目标设备：CPU / GPU / NPU */
  deviceType?: string;
  /** 该变体的执行提供程序（如 CPU / WebGPU） */
  executionProvider?: string;
  isCached: boolean;
  isLoaded: boolean;
  /** 该模型还有哪些设备的变体，如 ['GPU','CPU'] */
  deviceVariants: string[];
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

/** 执行提供程序下载进度的占位 alias（后端复用同一套进度帧） */
export const EP_PROGRESS_KEY = '__ep__';

/**
 * 消费 SSE 进度流。后端以 data: {alias,progress,state,error} 推送，
 * 这里手工 fetch 而不是走 axios 拦截器——拦截器要求统一响应结构，而 SSE 帧不是。
 */
async function streamProgress(
  url: string,
  onProgress: (progress: FoundryLocalDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `request failed: ${response.status}`);
  }
  await consumeSseStream(response, ({ data }) => {
    if (!data || data.startsWith(SSE_ERROR_PREFIX)) {
      onProgress({ alias: EP_PROGRESS_KEY, state: 'failed', error: data.replace(SSE_ERROR_PREFIX, '').trim() });
      return;
    }
    try {
      onProgress(JSON.parse(data) as FoundryLocalDownloadProgress);
    } catch {
      // 非 JSON 帧（心跳等）忽略
    }
  }, { signal });
}

export const foundryLocalService = {
  getStatus: () => get<FoundryLocalStatus>('/foundry-local/status'),
  getModels: (cachedOnly = false) =>
    get<FoundryLocalModel[]>(`/foundry-local/models?cachedOnly=${cachedOnly}`),
  getLoadedModels: () => get<FoundryLocalModel[]>('/foundry-local/models/loaded'),
  register: (variantId: string, purpose: 'chat' | 'embedding' = 'chat') =>
    post<string>(`/foundry-local/models/${encodeURIComponent(variantId)}/register?purpose=${purpose}`),
  load: (variantId: string) =>
    post<void>(`/foundry-local/models/${encodeURIComponent(variantId)}/load`),
  unload: (variantId: string) =>
    post<void>(`/foundry-local/models/${encodeURIComponent(variantId)}/unload`),
  remove: (variantId: string) =>
    del<void>(`/foundry-local/models/${encodeURIComponent(variantId)}`),
  startService: () => post<void>('/foundry-local/service/start'),
  stopService: () => post<void>('/foundry-local/service/stop'),
  setModelDir: (path: string | null) =>
    put<string>('/foundry-local/model-dir', { path: path ?? '' }),
  /** 下载模型，SSE 推进度 */
  download: (variantId: string, onProgress: (p: FoundryLocalDownloadProgress) => void, signal?: AbortSignal) =>
    streamProgress(`/api/foundry-local/models/${encodeURIComponent(variantId)}/download`, onProgress, signal),
  /** 下载并注册执行提供程序（GPU/NPU 后端），SSE 推进度 */
  downloadExecutionProviders: (onProgress: (p: FoundryLocalDownloadProgress) => void, signal?: AbortSignal) =>
    streamProgress('/api/foundry-local/execution-providers/download', onProgress, signal),
};
