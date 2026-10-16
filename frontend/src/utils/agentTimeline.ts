import type { ToolCallEntry } from './toolRendering'
import type { SubagentEntry } from './agentStream'

/**
 * Agent 执行过程的时间线条目。对话页、编码会话、任务看板详情三端
 * 各自的数据源（流式 store / 工作会话本地状态 / 落库步骤）都归一到这个模型，
 * 再由同一个 <see cref="default"/> 组件渲染。
 */
export type AgentTimelineItem =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; id?: string; name: string; args: string; result?: string; isError?: boolean; running?: boolean }
  | { kind: 'approval'; id: string; name: string; arguments: string }
  | { kind: 'file'; path: string; action: string }
  | { kind: 'checkpoint'; id: string; label: string; fileCount?: number }
  | { kind: 'subagent'; id: string; description: string; stage: string; tool?: string; steps?: number; message?: string; entries?: AgentTimelineItem[] }

/**
 * 派子 Agent 的 work_task 工具行与相邻的子 Agent 面板是同一件事：
 * 面板本身已经承载描述、步数与内层过程，再留一张「派子 Agent」卡片就会出现
 * 「工具卡压在面板下面」（历史里子 Agent 先落库、工具结果后落库，顺序还会反过来）。
 * 并行派多个子 Agent 时历史里是「subagent × N 后紧跟 tool × N」的连排，
 * 丢弃状态沿连续的 work_task 行向前传播，否则会漏掉最后一张卡。
 */
function dropSubagentToolRows(items: AgentTimelineItem[]): AgentTimelineItem[] {
  const result: AgentTimelineItem[] = []
  let prevDroppedWorkTask = false
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (item.kind === 'tool' && item.name === 'work_task') {
      const drop: boolean = prevDroppedWorkTask
        || items[index - 1]?.kind === 'subagent'
        || items[index + 1]?.kind === 'subagent'
      prevDroppedWorkTask = drop
      if (drop) continue
    } else {
      prevDroppedWorkTask = false
    }
    result.push(item)
  }
  return result
}

/** 子 Agent 内层时间线（事件 / 落库里的 entries）→ 统一时间线条目，直接嵌套渲染 */
export function subagentEntriesToTimeline(entries: readonly SubagentEntry[] | undefined): AgentTimelineItem[] {
  const out: AgentTimelineItem[] = []
  for (const entry of entries ?? []) {
    // 后端条目用 thinking / 落库的历史用 thought，两种都要认，否则思考会被当正文渲染
    if (entry.kind === 'thought' || entry.kind === 'thinking') out.push({ kind: 'thought', text: entry.text ?? '' })
    else if (entry.kind === 'tool') {
      out.push({
        kind: 'tool',
        name: entry.name ?? '',
        args: entry.args ?? '{}',
        result: entry.result,
        isError: entry.isError,
        running: entry.result === undefined,
      })
    } else out.push({ kind: 'text', text: entry.text ?? '' })
  }
  return out
}

/** 折叠后的展示项：两段输出之间的过程条目合并为一组，其他条目原样保留 */
export type FoldedAgentItem =
  | { kind: 'tool'; items: ToolCallEntry[] }
  | { kind: 'other'; item: AgentTimelineItem }

/**
 * 把时间线折叠为展示项：连续的 工具/思考 合并成一组（组内保序），
 * 文本 / 审批 / 文件 / 检查点 / 子 Agent 原样穿插保留，并作为组的边界。
 */
export function foldAgentTimeline(items: AgentTimelineItem[]): FoldedAgentItem[] {
  const result: FoldedAgentItem[] = []
  let group: ToolCallEntry[] = []

  const flush = () => {
    if (group.length === 0) return
    result.push({ kind: 'tool', items: group })
    group = []
  }

  for (const item of items) {
    if (item.kind === 'tool' || item.kind === 'thought') {
      group.push(
        item.kind === 'thought'
          ? { kind: 'thought', text: item.text, name: '', args: '' }
          : {
              id: item.id,
              name: item.name,
              args: item.args,
              result: item.result,
              isError: item.isError,
              running: item.running ?? item.result === undefined,
            },
      )
      continue
    }
    flush()
    result.push({ kind: 'other', item })
  }
  flush()

  return result
}

/**
 * 把对话页流式 store 的时间线（字段名为 arguments，且随助手消息持久化）
 * 归一为 <see cref="AgentTimelineItem"/>。保持 store 的持久化形状不变，
 * 只在此处做字段映射，避免破坏历史消息解析。
 */
export function fromChatTimeline(items: readonly {
  kind: string
  text?: string
  name?: string
  arguments?: string
  result?: string
  isError?: boolean
  running?: boolean
  id?: string
  path?: string
  action?: string
  label?: string
  fileCount?: number
  description?: string
  stage?: string
  tool?: string
  steps?: number
  message?: string
  entries?: SubagentEntry[]
}[]): AgentTimelineItem[] {
  const result: AgentTimelineItem[] = []

  for (const item of items) {
    switch (item.kind) {
      case 'text':
        result.push({ kind: 'text', text: item.text ?? '' })
        break
      case 'thought':
        result.push({ kind: 'thought', text: item.text ?? '' })
        break
      case 'tool':
        result.push({
          kind: 'tool',
          id: item.id,
          name: item.name ?? '',
          args: item.arguments ?? '{}',
          result: item.result,
          isError: item.isError,
          running: item.running,
        })
        break
      case 'approval':
        result.push({ kind: 'approval', id: item.id ?? '', name: item.name ?? '', arguments: item.arguments ?? '{}' })
        break
      case 'file':
        result.push({ kind: 'file', path: item.path ?? '', action: item.action ?? 'write' })
        break
      case 'checkpoint':
        result.push({ kind: 'checkpoint', id: item.id ?? '', label: item.label ?? '', fileCount: item.fileCount })
        break
      case 'subagent':
        result.push({
          kind: 'subagent',
          id: item.id ?? '',
          description: item.description ?? '',
          stage: item.stage ?? 'done',
          tool: item.tool,
          steps: item.steps,
          message: item.message,
          entries: subagentEntriesToTimeline(item.entries),
        })
        break
    }
  }

  return dropSubagentToolRows(result)
}

/**
 * 把编码会话的流式条目（本地 state，带 seq 与按 id 去重语义）
 * 归一为 <see cref="AgentTimelineItem"/>。
 */
export function fromWorkStreamItems(items: readonly {
  kind: string
  seq?: number
  text?: string
  id?: string
  name?: string
  arguments?: string
  args?: string
  result?: string
  path?: string
  action?: string
  label?: string
  fileCount?: number
  description?: string
  stage?: string
  tool?: string
  steps?: number
  message?: string
  entries?: SubagentEntry[]
}[]): AgentTimelineItem[] {
  const result: AgentTimelineItem[] = []

  for (const item of items) {
    switch (item.kind) {
      case 'text':
        result.push({ kind: 'text', text: item.text ?? '' })
        break
      case 'thought':
        result.push({ kind: 'thought', text: item.text ?? '' })
        break
      case 'tool':
        result.push({
          kind: 'tool',
          id: item.id,
          name: item.name ?? '',
          args: item.args ?? item.arguments ?? '{}',
          result: item.result,
          running: item.result === undefined,
        })
        break
      case 'approval':
        result.push({ kind: 'approval', id: item.id ?? '', name: item.name ?? '', arguments: item.arguments ?? '{}' })
        break
      case 'file':
        result.push({ kind: 'file', path: item.path ?? '', action: item.action ?? 'write' })
        break
      case 'checkpoint':
        result.push({ kind: 'checkpoint', id: item.id ?? '', label: item.label ?? '', fileCount: item.fileCount })
        break
      case 'subagent':
        result.push({
          kind: 'subagent',
          id: item.id ?? '',
          description: item.description ?? '',
          stage: item.stage ?? 'done',
          tool: item.tool,
          steps: item.steps,
          message: item.message,
          entries: subagentEntriesToTimeline(item.entries),
        })
        break
    }
  }

  return dropSubagentToolRows(result)
}

/**
 * 把落库的执行步骤（任务看板 / 工作会话历史）归一为时间线条目。
 * 步骤类型：Thought / Text / ToolCall / ToolResult / Node（ToolCall 与 ToolResult 成对出现）。
 */
export function fromRunSteps<T extends { id: string; kind: string; title?: string | null; content: string }>(
  steps: T[],
): AgentTimelineItem[] {
  const items: AgentTimelineItem[] = []
  const awaitingResult: ToolCallEntry[] = []
  /** 按先后顺序取出最早等待结果的调用（ToolCall 与 ToolResult 的 id 各自独立） */
  // ToolCall 与 ToolResult 的 id 各自独立，结果按先后顺序配对最早的调用

  for (const step of steps) {
    const kind = step.kind
    if (kind === 'ToolCall') {
      awaitingResult.push({ id: step.id, name: step.title ?? '', args: step.content })
      continue
    }
    if (kind === 'ToolResult') {
      // ToolCall 与 ToolResult 的 id 不同（各自独立），按先后顺序配对

      const entry = awaitingResult.shift()
      items.push({
        kind: 'tool',
        id: entry?.id ?? step.id,
        name: entry?.name ?? step.title ?? '',
        args: entry?.args ?? '{}',
        result: step.content,
        isError: (step as { isError?: boolean }).isError,
        running: false,
      })
      continue
    }
    // 结果后到：先把已收集的调用按原顺序入列
    for (const entry of awaitingResult) {
      items.push({ kind: 'tool', id: entry.id, name: entry.name, args: entry.args, running: true })
    }
    awaitingResult.length = 0

    if (kind === 'Thought') items.push({ kind: 'thought', text: step.content })
    else if (kind === 'Text') items.push({ kind: 'text', text: step.content })
    else if (kind === 'Node') items.push({ kind: 'subagent', id: step.id, description: step.content, stage: 'done' })
  }

  for (const entry of awaitingResult) {
    items.push({ kind: 'tool', id: entry.id, name: entry.name, args: entry.args, running: true })
  }

  return items
}

