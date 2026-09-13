import { useCallback, useMemo } from 'react'
import { useChatStreamStore, getTopicStream } from '../stores/chatStreamStore'
import type { ApprovalRequest, TopicStreamState } from '../stores/chatStreamStore'

export type {
  StreamingQuestion,
  StreamingTodo,
  StreamingToolCall,
  StreamingToolResult,
  ApprovalRequest,
  SearchResult,
  KnowledgeResult,
  MemoryResult,
} from '../stores/chatStreamStore'

type Setter<T> = (v: T | ((prev: T) => T)) => void

/** 生成某个话题流式状态下单个字段的 setter，支持直接赋值或函数式更新 */
function useStreamField<K extends keyof TopicStreamState>(id: string, key: K): Setter<TopicStreamState[K]> {
  return useCallback(
    (v: TopicStreamState[K] | ((prev: TopicStreamState[K]) => TopicStreamState[K])) => {
      useChatStreamStore.getState().update(id, (cur) => {
        const value = typeof v === 'function' ? (v as (prev: TopicStreamState[K]) => TopicStreamState[K])(cur[key]) : v
        return { [key]: value } as Partial<TopicStreamState>
      })
    },
    [id, key],
  )
}

/**
 * 订阅某个话题的全局流式状态。状态保存在全局 store（按 topicId 隔离），
 * 组件卸载/切换话题不会丢失，支持多话题同时流式。
 */
export function useStreaming(topicId: string | undefined) {
  const id = topicId ?? ''
  const raw = useChatStreamStore((st) => st.streams[id])
  // 缓存空对象，避免 selector 每次返回新引用导致 useSyncExternalStore 无限重渲染
  const s = useMemo(() => raw ?? getTopicStream({}, ''), [raw])
  const store = useChatStreamStore.getState()

  const setStreamingContent = useStreamField(id, 'streamingContent')
  const setStreamingThinking = useStreamField(id, 'streamingThinking')
  const setShowThinking = useStreamField(id, 'showThinking')
  const setPendingUserMessage = useStreamField(id, 'pendingUserMessage')
  const setStreamingSearchResults = useStreamField(id, 'searchResults')
  const setStreamingKnowledgeResults = useStreamField(id, 'knowledgeResults')
  const setStreamingMemoryResults = useStreamField(id, 'memoryResults')
  const setStreamingToolResults = useStreamField(id, 'toolResults')
  const setStreamingQuestions = useStreamField(id, 'questions')
  const setQuestionAnswers = useStreamField(id, 'questionAnswers')
  const setCurrentQuestionIndex = useStreamField(id, 'currentQuestionIndex')
  const setStreamingTodos = useStreamField(id, 'todos')
  const setTodoPanelCollapsed = useStreamField(id, 'todoPanelCollapsed')

  return {
    streamingContent: s.streamingContent,
    setStreamingContent,
    streamingThinking: s.streamingThinking,
    setStreamingThinking,
    showThinking: s.showThinking,
    setShowThinking,
    isStreaming: s.isStreaming,
    pendingUserMessage: s.pendingUserMessage,
    setPendingUserMessage,
    streamingSearchResults: s.searchResults,
    setStreamingSearchResults,
    streamingKnowledgeResults: s.knowledgeResults,
    setStreamingKnowledgeResults,
    streamingMemoryResults: s.memoryResults,
    setStreamingMemoryResults,
    streamingToolCalls: s.toolCalls,
    streamingToolResults: s.toolResults,
    setStreamingToolResults,
    streamingQuestions: s.questions,
    setStreamingQuestions,
    questionAnswers: s.questionAnswers,
    setQuestionAnswers,
    currentQuestionIndex: s.currentQuestionIndex,
    setCurrentQuestionIndex,
    streamingTodos: s.todos,
    setStreamingTodos,
    todoPanelCollapsed: s.todoPanelCollapsed,
    setTodoPanelCollapsed,
    approvalRequests: s.approvalRequests as ApprovalRequest[],
    startStreaming: store.start,
    stopStreaming: store.stop,
    handleSseChunk: store.handleChunk,
  }
}
