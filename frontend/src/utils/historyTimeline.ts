import type { IWorkMessage } from '../types/work'
import { subagentEntriesToTimeline, type AgentTimelineItem } from './agentTimeline'

/** 对话消息里持久化的有序片段（新格式）。旧格式为纯工具数组，由调用方先归一。 */
export interface ChatHistorySegment {
  kind: 'text' | 'thought' | 'tool'
  text?: string
  name?: string
  arguments?: string
  result?: string
  isError?: boolean
}

/**
 * 对话历史片段 → 统一时间线条目。
 * 折叠、行样式与间距交给 AgentTimeline，历史消息不再各自实现一套。
 */
export function fromChatHistorySegments(segments: readonly ChatHistorySegment[]): AgentTimelineItem[] {
  return segments.map((segment): AgentTimelineItem => {
    if (segment.kind === 'thought') return { kind: 'thought', text: segment.text ?? '' }
    if (segment.kind === 'text') return { kind: 'text', text: segment.text ?? '' }
    return {
      kind: 'tool',
      name: segment.name ?? '',
      args: segment.arguments ?? '{}',
      result: segment.result,
      isError: segment.isError,
    }
  })
}

function parseMetadata<T>(metadata: string | null | undefined, fallback: T): T {
  if (!metadata) return fallback
  try {
    return { ...fallback, ...(JSON.parse(metadata) as T) }
  } catch {
    return fallback
  }
}

/**
 * Code 会话历史消息（思考 / 工具 / 子 Agent / 文件变更 / 检查点）→ 统一时间线条目。
 * 用户与正文消息由调用方单独渲染，这里只处理过程条目。
 */
export function fromWorkHistoryMessages(messages: readonly IWorkMessage[]): AgentTimelineItem[] {
  const items: AgentTimelineItem[] = []
  for (const message of messages) {
    switch (message.type) {
      case 'thought':
        items.push({ kind: 'thought', text: message.content })
        break
      case 'tool': {
        const meta = parseMetadata(message.metadata, { name: '', arguments: '{}', isError: false })
        items.push({
          kind: 'tool',
          id: message.id,
          name: meta.name,
          args: meta.arguments,
          result: message.content,
          isError: meta.isError,
        })
        break
      }
      case 'subagent': {
        const meta = parseMetadata(message.metadata, {
          id: '',
          description: '',
          steps: undefined as number | undefined,
          message: undefined as string | undefined,
          entries: undefined as Parameters<typeof subagentEntriesToTimeline>[0],
        })
        items.push({
          kind: 'subagent',
          id: meta.id || message.id,
          description: meta.description || message.content,
          stage: 'done',
          steps: meta.steps,
          message: meta.message,
          entries: subagentEntriesToTimeline(meta.entries),
        })
        break
      }
      case 'file_change': {
        const meta = parseMetadata(message.metadata, { path: '', action: 'write' })
        // 连续同一文件同一动作只保留一行：一轮里多次写同一文件时，卡片会连排重复
        const last = items[items.length - 1]
        if (last?.kind === 'file' && last.path === meta.path && last.action === meta.action) break
        items.push({ kind: 'file', path: meta.path, action: meta.action })
        break
      }
      case 'checkpoint': {
        const meta = parseMetadata(message.metadata, { id: '', fileCount: undefined as number | undefined })
        if (meta.id) items.push({ kind: 'checkpoint', id: meta.id, label: message.content, fileCount: meta.fileCount })
        break
      }
    }
  }
  return items
}
