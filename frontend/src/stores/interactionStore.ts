import { create } from 'zustand'
import { chatMessageService } from '../services/chatService'

export type InteractionTodoStatus = 'not-started' | 'in-progress' | 'completed'

export interface InteractionQuestion {
  id: string
  toolCallId: string
  header: string
  question: string
  options?: Array<{ label: string; description?: string }>
  allowCustom?: boolean
}

export interface InteractionTodo {
  id: string
  title: string
  description?: string
  status: InteractionTodoStatus
}

export interface InteractionPlanStep {
  id: string
  title: string
  description?: string
  status?: 'pending' | 'in-progress' | 'completed'
}

export interface InteractionPlan {
  toolCallId: string
  title: string
  summary: string
  steps: InteractionPlanStep[]
  /** 用户输入的计划修改意见（驳回时回传给模型） */
  feedback: string
  decided?: 'approved' | 'rejected'
}

export interface InteractionState {
  questions: InteractionQuestion[]
  questionIndex: number
  questionAnswers: Record<string, string>
  todos: InteractionTodo[]
  plan: InteractionPlan | null
}

export const emptyInteraction = (): InteractionState => ({
  questions: [],
  questionIndex: 0,
  questionAnswers: {},
  todos: [],
  plan: null,
})

type RawChunk = Record<string, unknown>

/** 选择器默认空态：共享同一引用，避免 getSnapshot 每次返回新对象导致无限重渲染 */
const EMPTY_INTERACTION: InteractionState = Object.freeze(emptyInteraction())

/** SSE data 字段可能是字符串化的 JSON，统一解析为对象 */
function parseData(data: unknown): RawChunk | null {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      return parsed && typeof parsed === 'object' ? (parsed as RawChunk) : null
    } catch {
      return null
    }
  }
  return data && typeof data === 'object' ? (data as RawChunk) : null
}

function questionFromRaw(raw: RawChunk, toolCallId: string, i: number): InteractionQuestion {
  const options = Array.isArray(raw.options)
    ? (raw.options as Array<{ label?: string; description?: string }>)
        .filter(o => o && typeof o.label === 'string')
        .map(o => ({ label: o.label as string, description: o.description }))
    : undefined
  return {
    id: `${toolCallId || 'q'}_${i}`,
    toolCallId,
    header: typeof raw.header === 'string' && raw.header ? raw.header : '请回答',
    question: typeof raw.question === 'string' ? raw.question : '',
    options: options && options.length > 0 ? options : undefined,
    allowCustom: raw.allowCustom !== false,
  }
}

function todoFromRaw(raw: RawChunk, idx: number): InteractionTodo {
  const status = raw.status
  return {
    id: (typeof raw.id === 'string' && raw.id) || `t${idx}`,
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    status: status === 'completed' || status === 'in-progress' ? status : 'not-started',
  }
}

/**
 * 交互型工具（question / todo / plan）SSE 事件的纯函数处理。
 * 对话页与编码页共用同一份逻辑，保证两个入口行为一致。
 */
export function applyInteractionChunk(state: InteractionState, chunk: RawChunk): InteractionState {
  switch (chunk.type) {
    case 'question': {
      const qData = parseData(chunk.data)
      if (!qData || !Array.isArray(qData.questions)) return state
      const toolCallId = (chunk.toolCallId as string) || ''
      const incoming = (qData.questions as RawChunk[])
        .filter(q => q && typeof q === 'object')
        .map((q, i) => questionFromRaw(q, toolCallId, i))
      if (incoming.length === 0) return state
      // 同一 toolCallId 的重复事件做幂等替换，其余追加
      const rest = state.questions.filter(q => q.toolCallId !== toolCallId)
      const previous = state.questionAnswers
      const answers = { ...previous }
      for (const q of incoming) if (answers[q.id] === undefined) delete answers[q.id]
      return { ...state, questions: [...rest, ...incoming], questionAnswers: answers }
    }
    case 'todo': {
      const todoData = parseData(chunk.data)
      if (!todoData) return state
      const todos = todoData.todos
      if (Array.isArray(todos) && todos.length > 0) {
        return {
          ...state,
          todos: (todos as RawChunk[]).map(todoFromRaw),
        }
      }
      const action = todoData.action
      if (action === 'create' && typeof todoData.title === 'string' && todoData.title) {
        const next = todoFromRaw(todoData, state.todos.length)
        return {
          ...state,
          todos: state.todos.some(t => t.id === next.id) ? state.todos : [...state.todos, next],
        }
      }
      if (action === 'update' || action === 'complete') {
        const targetId = typeof todoData.id === 'string' ? todoData.id : ''
        const title = typeof todoData.title === 'string' ? todoData.title : ''
        if (!targetId && !title) return state
        const nextStatus: InteractionTodoStatus =
          action === 'complete' ? 'completed'
            : todoData.status === 'in-progress' || todoData.status === 'completed' ? todoData.status
              : 'in-progress'
        return {
          ...state,
          todos: state.todos.map(t =>
            targetId ? (t.id === targetId ? { ...t, status: nextStatus } : t)
              : t.title === title ? { ...t, status: nextStatus } : t,
          ),
        }
      }
      return state
    }
    case 'plan': {
      const planData = parseData(chunk.data)
      if (!planData || typeof planData.title !== 'string') return state
      const toolCallId = (chunk.toolCallId as string) || ''
      const steps = Array.isArray(planData.steps)
        ? (planData.steps as RawChunk[])
            .filter(s => s && typeof s.title === 'string')
            .map((s, i) => ({
              id: (typeof s.id === 'string' && s.id) || `p${i + 1}`,
              title: s.title as string,
              description: typeof s.description === 'string' ? s.description : undefined,
              status: s.status === 'in-progress' || s.status === 'completed' ? s.status : 'pending',
            })) as InteractionPlanStep[]
        : []
      return {
        ...state,
        plan: {
          toolCallId,
          title: planData.title,
          summary: typeof planData.summary === 'string' ? planData.summary : '',
          steps,
          feedback: '',
        },
      }
    }
    default:
      return state
  }
}

interface InteractionStore {
  /** streamKey：对话页为 topicId，编码页为 workSessionId（同时作为 answer/plan 接口的 sessionId） */
  streams: Record<string, InteractionState>
  applyChunk: (streamKey: string, chunk: RawChunk) => void
  answer: (streamKey: string, questionId: string, value: string) => void
  setQuestionIndex: (streamKey: string, idx: number) => void
  submitAnswers: (streamKey: string) => Promise<void>
  decidePlan: (streamKey: string, approved: boolean) => Promise<void>
  setPlanFeedback: (streamKey: string, feedback: string) => void
  clear: (streamKey: string) => void
}

const patch = (
  streams: Record<string, InteractionState>,
  streamKey: string,
  partial: Partial<InteractionState>,
): Record<string, InteractionState> => ({
  ...streams,
  [streamKey]: { ...(streams[streamKey] ?? emptyInteraction()), ...partial },
})

export const useInteractionStore = create<InteractionStore>((set, get) => ({
  streams: {},

  applyChunk: (streamKey, chunk) =>
    set((st) => {
      const cur = st.streams[streamKey] ?? emptyInteraction()
      const next = applyInteractionChunk(cur, chunk)
      return next === cur ? st : { streams: { ...st.streams, [streamKey]: next } }
    }),

  answer: (streamKey, questionId, value) =>
    set((st) => ({
      streams: patch(st.streams, streamKey, {
        questionAnswers: { ...(st.streams[streamKey]?.questionAnswers ?? {}), [questionId]: value },
      }),
    })),

  setQuestionIndex: (streamKey, idx) =>
    set((st) => ({ streams: patch(st.streams, streamKey, { questionIndex: idx }) })),

  submitAnswers: async (streamKey) => {
    const state = get().streams[streamKey]
    if (!state || !streamKey) return
    const { questions, questionAnswers } = state
    if (questions.length === 0 || !questions.every(q => questionAnswers[q.id])) return
    const toolCallId = questions[0].toolCallId
    const combined = questions.map(q => ({
      id: q.id,
      question: q.question,
      answer: questionAnswers[q.id],
    }))
    set((st) => ({ streams: patch(st.streams, streamKey, { questions: [], questionIndex: 0, questionAnswers: {} }) }))
    if (!toolCallId) return
    try {
      await chatMessageService.submitAnswer(streamKey, toolCallId, JSON.stringify(combined))
    } catch { /* 网络异常时已回答状态已清理，后端超时兜底 */ }
  },

  decidePlan: async (streamKey, approved) => {
    const state = get().streams[streamKey]
    if (!state?.plan || !streamKey || !state.plan.toolCallId) return
    const { toolCallId, feedback, decided } = state.plan
    if (decided) return
    set((st) => ({
      streams: patch(st.streams, streamKey, {
        plan: { ...(st.streams[streamKey]?.plan as InteractionPlan), decided: approved ? 'approved' : 'rejected' },
      }),
    }))
    try {
      await chatMessageService.submitPlanDecision(streamKey, toolCallId, approved, feedback || '')
    } catch { /* 网络异常时后端超时兜底 */ }
  },

  setPlanFeedback: (streamKey, feedback) =>
    set((st) => {
      const plan = st.streams[streamKey]?.plan
      if (!plan) return st
      return { streams: patch(st.streams, streamKey, { plan: { ...plan, feedback } }) }
    }),

  clear: (streamKey) =>
    set((st) => ({ streams: patch(st.streams, streamKey, emptyInteraction()) })),
}))

export const getInteraction = (
  streams: Record<string, InteractionState>,
  streamKey: string | undefined,
): InteractionState => (streamKey && streams[streamKey]) || EMPTY_INTERACTION
