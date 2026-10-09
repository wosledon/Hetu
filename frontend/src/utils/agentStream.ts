/**
 * Agent 流的统一帧解析。
 *
 * 对话、编码会话、工作流三条链路过去各有一套 SSE 解析（chatStreamStore.handleChunk /
 * WorkSessionArea.dispatchWorkEvent / 工作流自己的分支），事件集合也各不相同。
 * 这里收敛为一份：解析一帧 JSON → 类型化 AgentEvent，各端只写自己的 reducer。
 *
 * 事件集合取三者的并集（缺的字段由后端补发或忽略）：
 * content / thinking / tool_call / tool_result / approval_request /
 * question / todo / plan / usage / file_change / checkpoint / subagent /
 * search_results / knowledge_results / memory_results / debug / done
 */

export const SSE_ERROR_PREFIX = '[ERROR]'

/** 一帧 Agent 事件。字段按事件类型可选，解析后即规范化（不再有 undefined 字符串）。 */
export type AgentEvent =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string; hidden?: boolean }
  | { type: 'tool_result'; id: string; name: string; content: string; isError: boolean; collapsed?: boolean; hidden?: boolean }
  | { type: 'approval_request'; id: string; name: string; arguments: string }
  | { type: 'question'; toolCallId: string; data: unknown }
  | { type: 'todo'; data: unknown }
  | { type: 'plan'; toolCallId: string; data: unknown }
  | { type: 'usage'; promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number; latencyMs: number }
  | { type: 'file_change'; path: string; action: string }
  | { type: 'checkpoint'; id: string; label: string; fileCount: number }
  | { type: 'subagent'; id: string; description: string; stage: string; tool?: string; steps?: number; message?: string }
  | { type: 'search_results'; results: unknown[] }
  | { type: 'knowledge_results'; results: unknown[] }
  | { type: 'memory_results'; results: unknown[] }
  | { type: 'debug'; text: string }
  | { type: 'notice'; kind: string; text: string }
  | { type: 'done' }
  /** 已知类型之外的事件：保留原样，端上按需扩展而不丢帧 */
  | { type: 'unknown'; raw: Record<string, unknown> }

export interface ParseResult {
  event: AgentEvent | null
  /** 帧是错误帧（[ERROR] ...）时为错误文本 */
  error?: string
  /** 帧不是 JSON 时按纯文本正文处理 */
  plainText?: string
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 解析一帧 SSE data。三端共用的唯一入口：
 * - `[ERROR] ...` → error
 * - 合法 JSON → AgentEvent（未识别 type 进 unknown，不丢帧）
 * - 非 JSON → plainText（调用方按正文增量追加）
 */
export function parseAgentFrame(data: string): ParseResult {
  if (data.startsWith(SSE_ERROR_PREFIX)) {
    return { event: null, error: data.slice(SSE_ERROR_PREFIX.length).trim() }
  }

  let raw: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { event: null, plainText: data }
    }
    raw = parsed as Record<string, unknown>
  } catch {
    return { event: null, plainText: data }
  }

  const type = str(raw.type)
  switch (type) {
    case 'content':
      return { event: { type: 'content', text: str(raw.text) } }
    case 'thinking':
      return { event: { type: 'thinking', text: str(raw.text) } }
    case 'tool_call':
      return {
        event: {
          type: 'tool_call',
          id: str(raw.id),
          name: str(raw.name),
          arguments: str(raw.arguments, '{}'),
          hidden: raw.hidden === true,
        },
      }
    case 'tool_result':
      return {
        event: {
          type: 'tool_result',
          id: str(raw.id),
          name: str(raw.name),
          content: str(raw.content),
          isError: bool(raw.isError),
          collapsed: raw.collapsed === true,
          hidden: raw.hidden === true,
        },
      }
    case 'approval_request':
      return {
        event: {
          type: 'approval_request',
          id: str(raw.id),
          name: str(raw.name),
          arguments: str(raw.arguments, '{}'),
        },
      }
    case 'question':
      return { event: { type: 'question', toolCallId: str(raw.toolCallId), data: raw.data } }
    case 'todo':
      return { event: { type: 'todo', data: raw.data } }
    case 'plan':
      return { event: { type: 'plan', toolCallId: str(raw.toolCallId), data: raw.data } }
    case 'usage':
      return {
        event: {
          type: 'usage',
          promptTokens: num(raw.promptTokens),
          completionTokens: num(raw.completionTokens),
          cachedTokens: num(raw.cachedTokens),
          totalTokens: num(raw.totalTokens),
          latencyMs: num(raw.latencyMs),
        },
      }
    case 'file_change':
      return { event: { type: 'file_change', path: str(raw.path), action: str(raw.action) } }
    case 'checkpoint':
      return {
        event: {
          type: 'checkpoint',
          id: str(raw.id),
          label: str(raw.label),
          fileCount: num(raw.fileCount),
        },
      }
    case 'subagent':
      return {
        event: {
          type: 'subagent',
          id: str(raw.id),
          description: str(raw.description),
          stage: str(raw.stage),
          tool: typeof raw.tool === 'string' ? raw.tool : undefined,
          steps: typeof raw.steps === 'number' ? raw.steps : undefined,
          message: typeof raw.message === 'string' ? raw.message : undefined,
        },
      }
    case 'search_results':
      return { event: { type: 'search_results', results: arr(raw.results) } }
    case 'knowledge_results':
      return { event: { type: 'knowledge_results', results: arr(raw.results) } }
    case 'memory_results':
      return { event: { type: 'memory_results', results: arr(raw.results) } }
    case 'debug':
      return { event: { type: 'debug', text: str(raw.text) } }
    case 'notice':
      return { event: { type: 'notice', kind: str(raw.kind, 'info'), text: str(raw.text) } }
    case 'done':
      return { event: { type: 'done' } }
    default:
      return { event: { type: 'unknown', raw } }
  }
}

/** 累计用量快照（编码会话顶栏、对话页用量徽标共用） */
export interface AgentUsage {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  totalTokens: number
  latencyMs: number
}

export const EMPTY_USAGE: AgentUsage = {
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  latencyMs: 0,
}

/** 把一帧 usage 事件累加到快照上（usage 帧本身就是累计值，直接覆盖） */
export function applyUsage(event: Extract<AgentEvent, { type: 'usage' }>): AgentUsage {
  return {
    promptTokens: event.promptTokens,
    completionTokens: event.completionTokens,
    cachedTokens: event.cachedTokens,
    totalTokens: event.totalTokens,
    latencyMs: event.latencyMs,
  }
}

/** token 数的简短展示：1234 → 1.2k */
export function formatTokens(tokens: number): string {
  if (tokens <= 0) return '0'
  if (tokens < 1000) return String(tokens)
  return `${(tokens / 1000).toFixed(tokens < 10000 ? 1 : 0)}k`
}
