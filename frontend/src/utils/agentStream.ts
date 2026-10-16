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

/** 子 Agent 内层时间线的条目（思考 / 正文 / 工具调用），由 work_task 转发与落库 */
export interface SubagentEntry {
  /** thinking | text | tool */
  kind: string
  text?: string
  name?: string
  args?: string
  result?: string
  isError?: boolean
}

/** 解析后的子 Agent 帧（start / delta / tool / tool_result / done / error） */
export type SubagentFrame = Extract<AgentEvent, { type: 'subagent' }>

/**
 * 展示用的子 Agent 阶段：start / delta / tool / tool_result 都算「进行中」，
 * 只有 done / error 才是终态——否则中间帧会把面板的运行态覆盖掉
 * （转场动画消失、进行中提示闪断）。
 */
export function subagentStage(stage: string): string {
  if (stage === 'done' || stage === 'error') return stage
  return 'running'
}

/**
 * 把一条子 Agent 帧并入内层时间线：
 * 思考 / 正文增量按序合并成同一条，工具调用先行占位（等待结果），
 * done / error 时用后端回传的完整时间线覆盖。
 */
export function mergeSubagentEntries(entries: SubagentEntry[], event: SubagentFrame): SubagentEntry[] {
  const next = [...entries]
  if (event.stage === 'delta' && event.text) {
    const kind = event.kind === 'thinking' ? 'thinking' : 'text'
    const last = next[next.length - 1]
    if (last && last.kind === kind) next[next.length - 1] = { ...last, text: (last.text ?? '') + event.text }
    else next.push({ kind, text: event.text })
    return next
  }
  if (event.stage === 'tool' && event.tool) {
    next.push({ kind: 'tool', name: event.tool, args: event.arguments ?? '{}' })
    return next
  }
  if (event.stage === 'tool_result' && event.tool) {
    for (let i = next.length - 1; i >= 0; i--) {
      const entry = next[i]
      if (entry.kind === 'tool' && entry.name === event.tool && entry.result === undefined) {
        next[i] = { ...entry, result: event.result ?? '', isError: event.isError === true }
        break
      }
    }
    return next
  }
  if ((event.stage === 'done' || event.stage === 'error') && event.entries && event.entries.length > 0) {
    return event.entries
  }
  return next
}

/**
 * 子 Agent 过程帧合批器。
 *
 * 一次子 Agent 运行会产生数百个 delta 帧，逐帧 setState 会反复重建整条内层时间线
 * （渲染被拖垮后表现为「内容铺成长竖列、折叠卡片缺失」）。这里把 ~100ms 窗内的
 * delta 合成一帧再交出去；非 delta 帧到达时先冲刷积压，保证事件顺序不乱。
 */
export function createSubagentCoalescer(
  sink: (event: SubagentFrame) => void,
  intervalMs = 100,
): { push: (event: SubagentFrame) => void; flush: () => void } {
  let pending: SubagentFrame[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.length === 0) return
    // 同一 id 的连续同类 delta 合成一帧，其余原样按序透传
    const batch: SubagentFrame[] = []
    for (const event of pending) {
      const last = batch[batch.length - 1]
      if (last && last.id === event.id && last.kind === event.kind) {
        batch[batch.length - 1] = { ...last, text: (last.text ?? '') + (event.text ?? '') }
        continue
      }
      batch.push({ ...event })
    }
    pending = []
    for (const event of batch) sink(event)
  }

  return {
    push(event) {
      if (event.stage === 'delta') {
        pending.push(event)
        if (timer === null) timer = setTimeout(flush, intervalMs)
        return
      }
      flush()
      sink(event)
    },
    flush,
  }
}

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
  | { type: 'subagent'; id: string; description: string; stage: string; tool?: string; steps?: number; message?: string; kind?: string; text?: string; arguments?: string; result?: string; isError?: boolean; entries?: SubagentEntry[] }
  | { type: 'search_results'; results: unknown[] }
  | { type: 'knowledge_results'; results: unknown[] }
  | { type: 'memory_results'; results: unknown[] }
  | { type: 'debug'; text: string }
  | { type: 'notice'; kind: string; text: string }
  | { type: 'steering'; text: string }
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

/** 解析子 Agent 内层时间线（落库 / done 帧回传的 entries） */
function subagentEntries(value: unknown): SubagentEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: SubagentEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    out.push({
      kind: str(entry.kind, 'text'),
      text: typeof entry.text === 'string' ? entry.text : undefined,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      args: typeof entry.args === 'string' ? entry.args : undefined,
      result: typeof entry.result === 'string' ? entry.result : undefined,
      isError: entry.isError === true,
    })
  }
  return out.length > 0 ? out : undefined
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
          kind: typeof raw.kind === 'string' ? raw.kind : undefined,
          text: typeof raw.text === 'string' ? raw.text : undefined,
          arguments: typeof raw.arguments === 'string' ? raw.arguments : undefined,
          result: typeof raw.result === 'string' ? raw.result : undefined,
          isError: raw.isError === true,
          entries: subagentEntries(raw.entries),
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
    case 'steering':
      return { event: { type: 'steering', text: str(raw.text) } }
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
