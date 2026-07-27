import { create } from 'zustand'

export interface StreamingQuestion {
  id: string
  toolCallId: string
  header: string
  question: string
  options?: Array<{ label: string; description?: string }>
  allowCustom?: boolean
  answered: boolean
  answer?: string
}

export interface StreamingTodo {
  id: string
  title: string
  description?: string
  status: 'not-started' | 'in-progress' | 'completed'
}

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
  pendingUserMessage: string | null
  searchResults: SearchResult[]
  knowledgeResults: KnowledgeResult[]
  memoryResults: MemoryResult[]
  toolCalls: StreamingToolCall[]
  toolResults: StreamingToolResult[]
  questions: StreamingQuestion[]
  questionAnswers: Record<string, string>
  currentQuestionIndex: number
  todos: StreamingTodo[]
  todoPanelCollapsed: boolean
  approvalRequests: ApprovalRequest[]
  usedWebSearch: boolean
  usedKnowledgeBase: boolean
  usedMemory: boolean
  /** 流开始时间（ms），用于判断乐观用户气泡是否已被持久化 */
  startedAt: number
}

const emptyTopic = (): TopicStreamState => ({
  isStreaming: false,
  streamingContent: '',
  streamingThinking: '',
  showThinking: false,
  pendingUserMessage: null,
  searchResults: [],
  knowledgeResults: [],
  memoryResults: [],
  toolCalls: [],
  toolResults: [],
  questions: [],
  questionAnswers: {},
  currentQuestionIndex: 0,
  todos: [],
  todoPanelCollapsed: false,
  approvalRequests: [],
  usedWebSearch: false,
  usedKnowledgeBase: false,
  usedMemory: false,
  startedAt: 0,
})

interface ChatStreamStore {
  streams: Record<string, TopicStreamState>
  update: (topicId: string, updater: (s: TopicStreamState) => Partial<TopicStreamState>) => void
  start: (topicId: string, opts: { content: string; webSearch: boolean; knowledgeBase: boolean; memory: boolean }) => void
  stop: (topicId: string) => void
  handleChunk: (topicId: string, chunk: Record<string, unknown>) => void
  appendContent: (topicId: string, text: string) => void
  clearAfterPersist: (topicId: string) => void
  setQuestionAnswer: (topicId: string, qId: string, answer: string) => void
  setQuestionIndex: (topicId: string, idx: number) => void
  clearQuestions: (topicId: string) => void
  removeApproval: (topicId: string, id: string) => void
  setShowThinking: (topicId: string, v: boolean) => void
  setTodoCollapsed: (topicId: string, v: boolean) => void
}

/** 每个话题进行中的流 AbortController（模块级，不进 zustand state） */
const streamControllers = new Map<string, AbortController>()

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

    start: (topicId, opts) =>
      patch(topicId, {
        ...emptyTopic(),
        isStreaming: true,
        pendingUserMessage: opts.content,
        usedWebSearch: opts.webSearch,
        usedKnowledgeBase: opts.knowledgeBase,
        usedMemory: opts.memory,
        startedAt: Date.now(),
      }),

    stop: (topicId) =>
      patch(topicId, { isStreaming: false, pendingUserMessage: null, startedAt: 0 }),

    appendContent: (topicId, text) =>
      set((st) => {
        const cur = st.streams[topicId] ?? emptyTopic()
        return {
          streams: {
            ...st.streams,
            [topicId]: { ...cur, streamingContent: cur.streamingContent + text },
          },
        }
      }),

    handleChunk: (topicId, chunk) =>
      set((st) => {
        const cur = st.streams[topicId] ?? emptyTopic()
        const next = { ...cur }
        switch (chunk.type) {
          case 'content':
            next.streamingContent = cur.streamingContent + ((chunk.text as string) || '')
            break
          case 'thinking':
            next.streamingThinking = cur.streamingThinking + ((chunk.text as string) || '')
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
            }
            break
          case 'tool_result':
            if (!chunk.hidden) {
              next.toolResults = [...cur.toolResults, { id: chunk.id as string, name: chunk.name as string, content: chunk.content as string, isError: chunk.isError as boolean, collapsed: chunk.collapsed as boolean }]
            }
            break
          case 'approval_request':
            next.approvalRequests = [...cur.approvalRequests, { id: chunk.id as string, name: chunk.name as string, arguments: chunk.arguments as string }]
            break
          case 'question': {
            try {
              const qData = typeof chunk.data === 'string' ? JSON.parse(chunk.data as string) : chunk.data
              if (qData?.questions) {
                const newQuestions = (qData.questions as Array<{ header?: string; question?: string; options?: Array<{ label: string; description?: string }>; allowCustom?: boolean }>).map((q, i) => ({
                  id: `${chunk.toolCallId || 'q'}_${i}`,
                  toolCallId: (chunk.toolCallId as string) || '',
                  header: q.header || '问题',
                  question: q.question || '',
                  options: q.options,
                  allowCustom: q.allowCustom !== false,
                  answered: false,
                  answer: undefined,
                }))
                next.questions = [...cur.questions, ...newQuestions]
              }
            } catch { /* ignore */ }
            break
          }
          case 'todo': {
            try {
              const todoData = typeof chunk.data === 'string' ? JSON.parse(chunk.data as string) : chunk.data
              if (Array.isArray(todoData?.todos) && todoData.todos.length > 0) {
                next.todos = (todoData.todos as Array<{ id?: string; title?: string; description?: string; status?: StreamingTodo['status'] }>).map((t) => ({
                  id: t.id || `t${Math.random().toString(36).slice(2)}`,
                  title: t.title || '',
                  description: t.description,
                  status: t.status || 'not-started',
                }))
              } else if (todoData?.action === 'create' && todoData?.title) {
                next.todos = [...cur.todos, { id: todoData.id || `t${cur.todos.length + 1}`, title: todoData.title, description: todoData.description, status: todoData.status || 'not-started' }]
              } else if (todoData?.action === 'update' && todoData?.id) {
                next.todos = cur.todos.map((t) => (t.id === todoData.id ? { ...t, status: todoData.status || t.status } : t))
              } else if (todoData?.action === 'complete' && todoData?.id) {
                next.todos = cur.todos.map((t) => (t.id === todoData.id ? { ...t, status: 'completed' } : t))
              }
            } catch { /* ignore */ }
            break
          }
        }
        return { streams: { ...st.streams, [topicId]: next } }
      }),

    clearAfterPersist: (topicId) =>
      patch(topicId, {
        streamingContent: '',
        streamingThinking: '',
        searchResults: [],
        knowledgeResults: [],
        memoryResults: [],
        toolCalls: [],
        toolResults: [],
        questions: [],
        todos: [],
        showThinking: false,
        usedWebSearch: false,
        usedKnowledgeBase: false,
        usedMemory: false,
      }),

    setQuestionAnswer: (topicId, qId, answer) =>
      set((st) => {
        const cur = st.streams[topicId] ?? emptyTopic()
        return { streams: { ...st.streams, [topicId]: { ...cur, questionAnswers: { ...cur.questionAnswers, [qId]: answer } } } }
      }),
    setQuestionIndex: (topicId, idx) => patch(topicId, { currentQuestionIndex: idx }),
    clearQuestions: (topicId) => patch(topicId, { questions: [], questionAnswers: {}, currentQuestionIndex: 0 }),
    removeApproval: (topicId, id) =>
      set((st) => {
        const cur = st.streams[topicId] ?? emptyTopic()
        return { streams: { ...st.streams, [topicId]: { ...cur, approvalRequests: cur.approvalRequests.filter((r) => r.id !== id) } } }
      }),
    setShowThinking: (topicId, v) => patch(topicId, { showThinking: v }),
    setTodoCollapsed: (topicId, v) => patch(topicId, { todoPanelCollapsed: v }),
  }
})

export const getTopicStream = (streams: Record<string, TopicStreamState>, topicId: string | undefined): TopicStreamState =>
  (topicId && streams[topicId]) || emptyTopic()
