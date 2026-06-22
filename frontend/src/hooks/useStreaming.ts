import { useState, useCallback } from 'react'

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

export function useStreaming() {
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')
  const [showThinking, setShowThinking] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null)

  // Search / knowledge / memory results
  const [streamingSearchResults, setStreamingSearchResults] = useState<SearchResult[]>([])
  const [streamingKnowledgeResults, setStreamingKnowledgeResults] = useState<KnowledgeResult[]>([])
  const [streamingMemoryResults, setStreamingMemoryResults] = useState<MemoryResult[]>([])

  // Tool calls
  const [streamingToolCalls, setStreamingToolCalls] = useState<StreamingToolCall[]>([])
  const [streamingToolResults, setStreamingToolResults] = useState<StreamingToolResult[]>([])

  // Questions
  const [streamingQuestions, setStreamingQuestions] = useState<StreamingQuestion[]>([])
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)

  // Todos
  const [streamingTodos, setStreamingTodos] = useState<StreamingTodo[]>([])
  const [todoPanelCollapsed, setTodoPanelCollapsed] = useState(false)

  // Approval
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([])

  const resetStreaming = useCallback(() => {
    setStreamingContent('')
    setStreamingThinking('')
    setStreamingSearchResults([])
    setStreamingKnowledgeResults([])
    setStreamingMemoryResults([])
    setStreamingToolCalls([])
    setStreamingToolResults([])
    setStreamingQuestions([])
    setStreamingTodos([])
    setApprovalRequests([])
    setQuestionAnswers({})
    setCurrentQuestionIndex(0)
    setShowThinking(false)
  }, [])

  const startStreaming = useCallback(() => {
    resetStreaming()
    setIsStreaming(true)
  }, [resetStreaming])

  const stopStreaming = useCallback(() => {
    setIsStreaming(false)
    setPendingUserMessage(null)
    setStreamingToolCalls([])
    setStreamingToolResults([])
  }, [])

  const handleSseChunk = useCallback((chunk: Record<string, unknown>) => {
    switch (chunk.type) {
      case 'content':
        setStreamingContent((prev: string) => prev + (chunk.text as string || ''))
        break
      case 'thinking':
        setStreamingThinking((prev: string) => prev + (chunk.text as string || ''))
        setShowThinking(true)
        break
      case 'search_results':
        setStreamingSearchResults((chunk.results as SearchResult[]) || [])
        break
      case 'knowledge_results':
        setStreamingKnowledgeResults((chunk.results as KnowledgeResult[]) || [])
        break
      case 'memory_results':
        setStreamingMemoryResults((chunk.results as MemoryResult[]) || [])
        break
      case 'tool_call':
        if (!chunk.hidden) {
          setStreamingToolCalls((prev: StreamingToolCall[]) => [...prev, {
            id: chunk.id as string,
            name: chunk.name as string,
            arguments: chunk.arguments as string,
          }])
        }
        break
      case 'tool_result':
        if (!chunk.hidden) {
          setStreamingToolResults((prev: StreamingToolResult[]) => [...prev, {
            id: chunk.id as string,
            name: chunk.name as string,
            content: chunk.content as string,
            isError: chunk.isError as boolean,
            collapsed: chunk.collapsed as boolean,
          }])
        }
        break
      case 'approval_request':
        setApprovalRequests((prev: ApprovalRequest[]) => [...prev, {
          id: chunk.id as string,
          name: chunk.name as string,
          arguments: chunk.arguments as string,
        }])
        break
      case 'question': {
        try {
          const qData = typeof chunk.data === 'string' ? JSON.parse(chunk.data as string) : chunk.data
          if (qData?.questions) {
            const newQuestions = (qData.questions as Array<{
              header?: string; question?: string;
              options?: Array<{ label: string; description?: string }>; allowCustom?: boolean
            }>).map((q, i) => ({
              id: `${chunk.toolCallId || 'q'}_${i}`,
              toolCallId: (chunk.toolCallId as string) || '',
              header: q.header || '问题',
              question: q.question || '',
              options: q.options,
              allowCustom: q.allowCustom !== false,
              answered: false,
              answer: undefined,
            }))
            setStreamingQuestions((prev: StreamingQuestion[]) => [...prev, ...newQuestions])
          }
        } catch { /* ignore */ }
        break
      }
      case 'todo': {
        try {
          const todoData = typeof chunk.data === 'string' ? JSON.parse(chunk.data as string) : chunk.data
          if (Array.isArray(todoData?.todos) && todoData.todos.length > 0) {
            setStreamingTodos((todoData.todos as Array<{
              id?: string; title?: string; description?: string; status?: 'not-started' | 'in-progress' | 'completed'
            }>).map((t) => ({
              id: t.id || `t${Math.random().toString(36).slice(2)}`,
              title: t.title || '',
              description: t.description,
              status: t.status || 'not-started',
            })))
          } else if (todoData?.action === 'create' && todoData?.title) {
            setStreamingTodos((prev: StreamingTodo[]) => [...prev, {
              id: todoData.id || `t${prev.length + 1}`,
              title: todoData.title,
              description: todoData.description,
              status: todoData.status || 'not-started',
            }])
          } else if (todoData?.action === 'update' && todoData?.id) {
            setStreamingTodos((prev: StreamingTodo[]) => prev.map((t) =>
              t.id === todoData.id ? { ...t, status: todoData.status || t.status } : t
            ))
          } else if (todoData?.action === 'complete' && todoData?.id) {
            setStreamingTodos((prev: StreamingTodo[]) => prev.map((t) =>
              t.id === todoData.id ? { ...t, status: 'completed' } : t
            ))
          }
        } catch { /* ignore */ }
        break
      }
    }
  }, [])

  return {
    streamingContent, setStreamingContent,
    streamingThinking, setStreamingThinking,
    showThinking, setShowThinking,
    isStreaming, pendingUserMessage, setPendingUserMessage,
    streamingSearchResults, setStreamingSearchResults,
    streamingKnowledgeResults, setStreamingKnowledgeResults,
    streamingMemoryResults, setStreamingMemoryResults,
    streamingToolCalls, streamingToolResults, setStreamingToolResults,
    streamingQuestions, setStreamingQuestions,
    questionAnswers, setQuestionAnswers,
    currentQuestionIndex, setCurrentQuestionIndex,
    streamingTodos, setStreamingTodos,
    todoPanelCollapsed, setTodoPanelCollapsed,
    approvalRequests, setApprovalRequests,
    resetStreaming, startStreaming, stopStreaming, handleSseChunk,
  }
}