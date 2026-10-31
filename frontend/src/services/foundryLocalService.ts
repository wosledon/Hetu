import { get, post, put, del } from './api';
import { consumeSseStream, SSE_ERROR_PREFIX } from '../utils/sse';

/** Foundry Local 运行时状态。整个模块是 foundry CLI 的一层壳，cliInstalled 是第一道判断 */
export interface FoundryLocalStatus {
  /** 是否找得到 foundry CLI；false 时页面应展示安装引导 */
  cliInstalled: boolean;
  /** CLI 版本，如 0.12.1 */
  cliVersion?: string;
  /** 当前平台是否支持（CLI 只在 Windows 上提供） */
  supported: boolean;
  /** 不支持时的原因（后端已本地化） */
  unsupportedReason?: string;
  /** 本地 OpenAI 兼容服务是否在跑 */
  running: boolean;
  /** 服务根地址（不含 /v1），如 http://127.0.0.1:62645 */
  endpoint?: string;
  /** 模型缓存目录 */
  cacheDir?: string;
  /** 本机 GPU 摘要（按名称去重，附带显存） */
  gpus: FoundryLocalDevice[];
  /** 本机 NPU 摘要 */
  npus: FoundryLocalDevice[];
  cpu?: string;
  availableMemoryBytes?: number;
  diskFreeBytes?: number;
  availableCount: number;
  loadedCount: number;
  cachedCount: number;
  /** CLI 自己给出的警告（如某个 EP 注册失败） */
  warnings: string[];
}

/** 本机运算设备（GPU / NPU）。CLI 会按适配器重复上报同一张卡，后端已按名称去重 */
export interface FoundryLocalDevice {
  name: string;
  vendor?: string;
  /** 专用显存 / 内存（字节）；集显报告的是共享内存，数值偏小 */
  videoMemoryBytes?: number;
}

/** Foundry Local 目录中的一个模型变体（同一模型按设备分多个变体） */
export interface FoundryLocalModel {
  alias: string;
  /** 变体 Id，CLI 与本地端点都用它寻址，如 qwen3-0.6b-pp-finetuned-generic-cpu:4 */
  id: string;
  displayName?: string;
  publisher?: string;
  /** 来源：Public / Local */
  source?: string;
  /** 任务类型：Chat / Embedding / Speech / Multimodal */
  task?: string;
  license?: string;
  /** 模型体积（MB） */
  fileSizeMb?: number;
  /** 该变体的目标设备：CPU / GPU / NPU */
  deviceType?: string;
  /** 该变体归一化后的执行提供程序（如 CPU / WebGPU / CUDA） */
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

/** 下载进度帧的占位 alias（后端复用同一套帧结构） */
export const PROGRESS_KEY = '__model__';

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
      onProgress({ alias: PROGRESS_KEY, state: 'failed', error: data.replace(SSE_ERROR_PREFIX, '').trim() });
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
  restartService: () => post<void>('/foundry-local/service/restart'),
  setCacheDir: (path: string | null) =>
    put<string>('/foundry-local/cache-dir', { path: path ?? '' }),
  /** 下载模型，SSE 推进度 */
  download: (variantId: string, onProgress: (p: FoundryLocalDownloadProgress) => void, signal?: AbortSignal) =>
    streamProgress(`/api/foundry-local/models/${encodeURIComponent(variantId)}/download`, onProgress, signal),
};
