import { useCallback, useMemo } from 'react'
import { useChatStreamStore, getTopicStream } from '../stores/chatStreamStore'
import type {
  StreamingQuestion,
  StreamingTodo,
  StreamingToolResult,
  ApprovalRequest,
  SearchResult,
  KnowledgeResult,
  MemoryResult,
} from '../stores/chatStreamStore'

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

  const setStreamingContent = useCallback(
    (v: string | ((p: string) => string)) =>
      useChatStreamStore.getState().update(id, (cur) => ({
        streamingContent: typeof v === 'function' ? v(cur.streamingContent) : v,
      })),
    [id],
  )
  const setStreamingThinking = useCallback(
    (v: string | ((p: string) => string)) =>
      useChatStreamStore.getState().update(id, (cur) => ({
        streamingThinking: typeof v === 'function' ? v(cur.streamingThinking) : v,
      })),
    [id],
  )
  const setShowThinking = useCallback(
    (v: boolean | ((p: boolean) => boolean)) =>
      useChatStreamStore.getState().update(id, (cur) => ({
        showThinking: typeof v === 'function' ? v(cur.showThinking) : v,
      })),
    [id],
  )
  const setPendingUserMessage = useCallback(
    (v: string | null) => useChatStreamStore.getState().update(id, () => ({ pendingUserMessage: v })),
    [id],
  )
  const setStreamingSearchResults = useCallback(
    (v: SearchResult[]) => useChatStreamStore.getState().update(id, () => ({ searchResults: v })),
    [id],
  )
  const setStreamingKnowledgeResults = useCallback(
    (v: KnowledgeResult[]) => useChatStreamStore.getState().update(id, () => ({ knowledgeResults: v })),
    [id],
  )
  const setStreamingMemoryResults = useCallback(
    (v: MemoryResult[]) => useChatStreamStore.getState().update(id, () => ({ memoryResults: v })),
    [id],
  )
  const setStreamingToolResults = useCallback(
    (v: StreamingToolResult[]) => useChatStreamStore.getState().update(id, () => ({ toolResults: v })),
    [id],
  )
  const setStreamingQuestions = useCallback(
    (v: StreamingQuestion[]) => useChatStreamStore.getState().update(id, () => ({ questions: v })),
    [id],
  )
  const setQuestionAnswers = useCallback(
    (v: Record<string, string> | ((p: Record<string, string>) => Record<string, string>)) =>
      useChatStreamStore.getState().update(id, (cur) => ({
        questionAnswers: typeof v === 'function' ? v(cur.questionAnswers) : v,
      })),
    [id],
  )
  const setCurrentQuestionIndex = useCallback(
    (v: number | ((p: number) => number)) =>
      useChatStreamStore.getState().update(id, (cur) => ({
        currentQuestionIndex: typeof v === 'function' ? v(cur.currentQuestionIndex) : v,
      })),
    [id],
  )
  const setStreamingTodos = useCallback(
    (v: StreamingTodo[]) => useChatStreamStore.getState().update(id, () => ({ todos: v })),
    [id],
  )
  const setTodoPanelCollapsed = useCallback(
    (v: boolean | ((p: boolean) => boolean)) =>
      useChatStreamStore.getState().update(id, (cur) => ({
        todoPanelCollapsed: typeof v === 'function' ? v(cur.todoPanelCollapsed) : v,
      })),
    [id],
  )

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
