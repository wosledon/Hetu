import { create } from 'zustand'
import { useInteractionStore } from './interactionStore'

export interface StreamingToolCall {
  id: string
  name: string
  arguments: string
}

export interface StreamingToolResult {
  id: string
  name: string
  content: string
  isError?: boolean
  collapsed?: boolean
}

export interface ApprovalRequest {
  id: string
  name: string
  arguments: string
}

/** 瀑布流时间线片段：按 SSE 到达顺序记录，保证文本与工具调用穿插展示 */
export interface TimelineItem {
  kind: 'text' | 'thought' | 'tool'
  /** text/thought：文本内容；tool：工具名 */
  text?: string
  name?: string
  arguments?: string
  result?: string
  isError?: boolean
  running?: boolean
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface KnowledgeResult {
  title: string
  contentSnippet: string
  id: string
}

export interface MemoryResult {
  id: string
  content: string
  category?: string
  score?: number
}

export interface TopicStreamState {
  isStreaming: boolean
  streamingContent: string
  streamingThinking: string
  showThinking: boolean
  /** 有序瀑布流：文本/思考/工具调用按发生顺序排列 */
  timeline: TimelineItem[]
  pendingUserMessage: string | null
  searchResults: SearchResult[]
  knowledgeResults: KnowledgeResult[]
  memoryResults: MemoryResult[]
  toolCalls: StreamingToolCall[]
  toolResults: StreamingToolResult[]
  approvalRequests: ApprovalRequest[]
  usedWebSearch: boolean
  usedKnowledgeBase: boolean
  usedMemory: boolean
  /** 流开始时间（ms），用于判断乐观用户气泡是否已被持久化 */
  startedAt: number
  /** 本次流失败的原因；不随流式预览一起清空，直到下次发送才重置 */
  streamError: string
}

const emptyTopic = (): TopicStreamState => ({
  isStreaming: false,
  streamingContent: '',
  streamingThinking: '',
  showThinking: false,
  timeline: [],
  pendingUserMessage: null,
  searchResults: [],
  knowledgeResults: [],
  memoryResults: [],
  toolCalls: [],
  toolResults: [],
  approvalRequests: [],
  usedWebSearch: false,
  usedKnowledgeBase: false,
  usedMemory: false,
  startedAt: 0,
  streamError: '',
})

interface ChatStreamStore {
  streams: Record<string, TopicStreamState>
  update: (topicId: string, updater: (s: TopicStreamState) => Partial<TopicStreamState>) => void
  start: (topicId: string, opts: { content: string; webSearch: boolean; knowledgeBase: boolean; memory: boolean }) => void
  stop: (topicId: string) => void
  handleChunk: (topicId: string, chunk: Record<string, unknown>) => void
  appendContent: (topicId: string, text: string) => void
  setStreamError: (topicId: string, message: string) => void
  clearAfterPersist: (topicId: string) => void
  removeApproval: (topicId: string, id: string) => void
  setShowThinking: (topicId: string, v: boolean) => void
}

/** 每个话题进行中的流 AbortController（模块级，不进 zustand state） */
const streamControllers = new Map<string, AbortController>()

/** 追加时间线片段：同类文本/思考片段合并到上一条，保持穿插顺序 */
function appendTimeline(list: TimelineItem[], item: TimelineItem): TimelineItem[] {
  const last = list[list.length - 1]
  if (last && last.kind === item.kind && item.kind !== 'tool') {
    return [...list.slice(0, -1), { ...last, text: (last.text ?? '') + (item.text ?? '') }]
  }
  return [...list, item]
}

/** 工具调用入列；结果到达时回填到对应片段 */
function withToolCall(list: TimelineItem[], call: { id: string; name: string; arguments: string }): TimelineItem[] {
  return [...list, { kind: 'tool', name: call.name, arguments: call.arguments, running: true }]
}

function withToolResult(list: TimelineItem[], result: { id: string; name: string; content: string; isError?: boolean }): TimelineItem[] {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.kind === 'tool' && item.running && item.name === result.name) {
      const next = [...list]
      next[i] = { ...item, result: result.content, isError: result.isError, running: false }
      return next
    }
  }
  return list
}

export const chatStreamControl = {
  register: (topicId: string, controller: AbortController) => streamControllers.set(topicId, controller),
  unregister: (topicId: string) => streamControllers.delete(topicId),
  cancel: (topicId: string) => {
    streamControllers.get(topicId)?.abort()
    streamControllers.delete(topicId)
  },
}

export const useChatStreamStore = create<ChatStreamStore>((set) => {
  const patch = (topicId: string, partial: Partial<TopicStreamState>) =>
    set((st) => ({
      streams: {
        ...st.streams,
        [topicId]: { ...(st.streams[topicId] ?? emptyTopic()), ...partial },
      },
    }))

  return {
    streams: {},
    update: (topicId, updater) =>
      set((st) => {
        const cur = st.streams[topicId] ?? emptyTopic()
        return { streams: { ...st.streams, [topicId]: { ...cur, ...updater(cur) } } }
      }),

    start: (topicId, opts) => {
      patch(topicId, {
        ...emptyTopic(),
        isStreaming: true,
        pendingUserMessage: opts.content,
        usedWebSearch: opts.webSearch,
        usedKnowledgeBase: opts.knowledgeBase,
        usedMemory: opts.memory,
        startedAt: Date.now(),
      })
      // 新流开始即清空上一轮的提问/任务/计划交互状态
      useInteractionStore.getState().clear(topicId)
    },

    stop: (topicId) =>
      patch(topicId, { isStreaming: false, pendingUserMessage: null, startedAt: 0 }),

    appendContent: (topicId, text) =>
      set((st) => {
        const cur = st.streams[topicId] ?? emptyTopic()
        return {
          streams: {
            ...st.streams,
            [topicId]: {
              ...cur,
              streamingContent: cur.streamingContent + text,
              timeline: appendTimeline(cur.timeline, { kind: 'text', text }),
            },
          },
        }
      }),

    setStreamError: (topicId, message) => patch(topicId, { streamError: message }),

    handleChunk: (topicId, chunk) =>
      set((st) => {
        // 交互型工具（question / todo / plan）走共享 interactionStore，对话页与编码页行为一致
        if (chunk.type === 'question' || chunk.type === 'todo' || chunk.type === 'plan') {
          useInteractionStore.getState().applyChunk(topicId, chunk)
          return st
        }

        const cur = st.streams[topicId] ?? emptyTopic()
        const next = { ...cur }
        switch (chunk.type) {
          case 'content':
            next.streamingContent = cur.streamingContent + ((chunk.text as string) || '')
            next.timeline = appendTimeline(cur.timeline, { kind: 'text', text: (chunk.text as string) || '' })
            break
          case 'thinking':
            next.streamingThinking = cur.streamingThinking + ((chunk.text as string) || '')
            next.timeline = appendTimeline(cur.timeline, { kind: 'thought', text: (chunk.text as string) || '' })
            next.showThinking = true
            break
          case 'search_results':
            next.searchResults = (chunk.results as SearchResult[]) || []
            break
          case 'knowledge_results':
            next.knowledgeResults = (chunk.results as KnowledgeResult[]) || []
            break
          case 'memory_results':
            next.memoryResults = (chunk.results as MemoryResult[]) || []
            break
          case 'tool_call':
            if (!chunk.hidden) {
              next.toolCalls = [...cur.toolCalls, { id: chunk.id as string, name: chunk.name as string, arguments: chunk.arguments as string }]
              next.timeline = withToolCall(cur.timeline, { id: chunk.id as string, name: chunk.name as string, arguments: chunk.arguments as string })
            }
            break
          case 'tool_result':
            if (!chunk.hidden) {
              next.toolResults = [...cur.toolResults, { id: chunk.id as string, name: chunk.name as string, content: chunk.content as string, isError: chunk.isError as boolean, collapsed: chunk.collapsed as boolean }]
              next.timeline = withToolResult(cur.timeline, { id: chunk.id as string, name: chunk.name as string, content: chunk.content as string, isError: chunk.isError as boolean })
            }
            break
          case 'approval_request':
            next.approvalRequests = [...cur.approvalRequests, { id: chunk.id as string, name: chunk.name as string, arguments: chunk.arguments as string }]
            break
        }
        return { streams: { ...st.streams, [topicId]: next } }
      }),

    clearAfterPersist: (topicId) => {
      patch(topicId, {
        streamingContent: '',
        streamingThinking: '',
        timeline: [],
        searchResults: [],
        knowledgeResults: [],
        memoryResults: [],
        toolCalls: [],
        toolResults: [],
        showThinking: false,
        usedWebSearch: false,
        usedKnowledgeBase: false,
        usedMemory: false,
      })
      // 交互型工具状态同样在消息刷新后清理（已提交的提问/任务不再停留在抽屉）
      useInteractionStore.getState().clear(topicId)
    },

    removeApproval: (topicId, id) =>
      set((st) => {
        const cur = st.streams[topicId] ?? emptyTopic()
        return { streams: { ...st.streams, [topicId]: { ...cur, approvalRequests: cur.approvalRequests.filter((r) => r.id !== id) } } }
      }),
    setShowThinking: (topicId, v) => patch(topicId, { showThinking: v }),
  }
})

export const getTopicStream = (streams: Record<string, TopicStreamState>, topicId: string | undefined): TopicStreamState =>
  (topicId && streams[topicId]) || emptyTopic()
