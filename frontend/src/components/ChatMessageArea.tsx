import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, FileText, Search, GitBranch, Check, X, Plus, Brain, Globe, Database, ChevronDown, Loader2, Atom, Zap, Square } from 'lucide-react'
import { workflowService, streamWorkflowRun } from '../services/workflowService'
import type { IWorkflow, IWorkflowEvent } from '../types/workflow'
import { chatMessageService, chatTopicService, promptPresetService } from '../services/chatService'
import type { ChatMessageSearchResult } from '../services/chatService'
import { notebookService } from '../services/notebookService'
import { skillService } from '../services/skillService'
import { aiModelService } from '../services/aiProviderService'
import ThemedMarkdown from './ThemedMarkdown'
import ChatMessageItem from './ChatMessageItem'
import { TodoPanel, QuestionPanel } from './ChatStreamPanels'
import Select from './Select'
import ToolCallsPanel from './ToolCallsPanel'
import ApprovalPanel from './ApprovalPanel'
import InlineWorkflowPanel from './workflow/InlineWorkflowPanel'
import type { WorkflowNodeState } from './workflow/InlineWorkflowPanel'
import { useStreaming } from '../hooks/useStreaming'
import { useChatStreamStore, chatStreamControl } from '../stores/chatStreamStore'
import { useConfirm } from './ConfirmDialog'
import { useUIStore } from '../stores/uiStore'
import type { IChatTopic, IPromptPreset, INotebook, IChatGroup } from '../types'

interface ChatMessageAreaProps {
  topic?: IChatTopic
  group?: IChatGroup
  onTopicUpdated?: (topic: IChatTopic) => void
}

function findNotebookName(notebooks: INotebook[], id: string): string {
  for (const nb of notebooks) {
    if (nb.id === id) return nb.name
    if (nb.children) {
      const found = findNotebookName(nb.children, id)
      if (found) return found
    }
  }
  return '默认笔记本'
}

function renderNotebookTree(
  notebooks: INotebook[],
  depth: number,
  selectedId: string,
  onSelect: (id: string, name: string) => void
): React.ReactNode[] {
  const result: React.ReactNode[] = []
  for (const nb of notebooks) {
    result.push(
      <button
        key={nb.id}
        type="button"
        onClick={() => onSelect(nb.id, nb.name)}
        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
          selectedId === nb.id
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {depth > 0 && <span className="text-gray-300 dark:text-gray-600 mr-1">└</span>}
        {nb.name}
      </button>
    )
    if (nb.children && nb.children.length > 0) {
      result.push(...renderNotebookTree(nb.children, depth + 1, selectedId, onSelect))
    }
  }
  return result
}

/**
 * 在后台消费某个话题的聊天 SSE 流，写入全局 store（按 topicId 隔离）。
 * 与组件挂载解耦：切换话题不会中断流，支持多话题同时流式，可随时中断。
 */
async function consumeChatStream(topicId: string, startRequest: (signal: AbortSignal) => Promise<Response>): Promise<void> {
  const store = useChatStreamStore.getState()
  const controller = new AbortController()
  chatStreamControl.register(topicId, controller)
  let cancelled = false
  try {
    const response = await startRequest(controller.signal)
    if (!response.body) return
    const reader = response.body.getReader()
    // 中断时取消 reader，使后端 ct 触发取消
    const onAbort = () => { cancelled = true; reader.cancel().catch(() => {}) }
    controller.signal.addEventListener('abort', onAbort)
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data.startsWith('[ERROR]')) {
            store.appendContent(topicId, '\n' + data)
            continue
          }
          try {
            store.handleChunk(topicId, JSON.parse(data))
          } catch {
            store.appendContent(topicId, data)
          }
        }
      }
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
      reader.releaseLock()
    }
  } catch (error) {
    if (cancelled || controller.signal.aborted) {
      // 用户主动中断，不视为错误
    } else {
      console.error('Stream error:', error)
      store.appendContent(topicId, '流式输出失败，请检查模型配置。')
    }
  } finally {
    chatStreamControl.unregister(topicId)
    store.stop(topicId)
    // 延迟清除流式状态，等消息列表刷新后再清理，避免闪烁
    setTimeout(() => store.clearAfterPersist(topicId), 500)
  }
}

export default function ChatMessageArea({ topic, group, onTopicUpdated }: ChatMessageAreaProps) {
  const queryClient = useQueryClient()
  const assistantName = useUIStore((state) => state.assistantName)
  const confirm = useConfirm()
  const [input, setInput] = useState('')
  const topicId = topic?.id
  const {
    streamingContent, setStreamingContent,
    streamingThinking,
    showThinking, setShowThinking,
    isStreaming, pendingUserMessage,
    streamingSearchResults,
    streamingKnowledgeResults,
    streamingMemoryResults,
    streamingToolCalls, streamingToolResults,
    streamingQuestions, setStreamingQuestions,
    questionAnswers, setQuestionAnswers,
    currentQuestionIndex, setCurrentQuestionIndex,
    streamingTodos,
    todoPanelCollapsed, setTodoPanelCollapsed,
    approvalRequests,
    startStreaming, stopStreaming,
  } = useStreaming(topicId)

  const streamWebSearch = useChatStreamStore((st) => (topicId ? st.streams[topicId]?.usedWebSearch : false) ?? false)
  const streamKnowledgeBase = useChatStreamStore((st) => (topicId ? st.streams[topicId]?.usedKnowledgeBase : false) ?? false)
  const streamMemory = useChatStreamStore((st) => (topicId ? st.streams[topicId]?.usedMemory : false) ?? false)
  const streamStartedAt = useChatStreamStore((st) => (topicId ? st.streams[topicId]?.startedAt : 0) ?? 0)
  const [isOrganizing, setIsOrganizing] = useState(false)
  const [organizeStyle, setOrganizeStyle] = useState<'summary' | 'detailed' | 'qna'>('summary')
  const [organizeTargetNotebook, setOrganizeTargetNotebook] = useState('')
  const [organizeResult, setOrganizeResult] = useState<{ noteId: string; title: string } | null>(null)
  const [showOrganizeOptions, setShowOrganizeOptions] = useState(false)
  const [showNotebookPicker, setShowNotebookPicker] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<IPromptPreset | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChatMessageSearchResult[]>([])
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [deepThinking, setDeepThinking] = useState(false)
  const [reasoningEffort, setReasoningEffort] = useState<string>('medium')
  const [showReasoningPicker, setShowReasoningPicker] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [knowledgeBase, setKnowledgeBase] = useState(false)
  const [toolCalling, setToolCalling] = useState(true)
  const [toolApprovalMode, setToolApprovalMode] = useState<'auto' | 'ask' | 'bypass'>('ask')
  const [showApprovalPicker, setShowApprovalPicker] = useState(false)
  const approvalPickerRef = useRef<HTMLDivElement>(null)
  const [memory, setMemory] = useState(false)
  const [runningWorkflow, setRunningWorkflow] = useState<IWorkflow | null>(null)
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNodeState[]>([])
  const [workflowRunId, setWorkflowRunId] = useState<string>('')
  const [pendingApproval, setPendingApproval] = useState<{ nodeId: string; prompt: string; runId: string } | null>(null)
  // 统一工作流工具交互：nodeId/toolCallId/name/arguments，name=ask_question 时显示提问面板，否则显示审批面板
  const [workflowToolCall, setWorkflowToolCall] = useState<{ nodeId: string; toolCallId: string; name: string; arguments: string } | null>(null)
  const [workflowError, setWorkflowError] = useState<string>('')
  const { data: availableWorkflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: workflowService.getAll })
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [slashMenuIndex, setSlashMenuIndex] = useState(0)
  const [selectedSlashItem, setSelectedSlashItem] = useState<{ label: string; icon: React.ReactNode; type: 'skill' | 'agent'; description?: string } | null>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const thinkingEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const agentPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const reasoningPickerRef = useRef<HTMLDivElement>(null)
  // 跟踪消息加载状态：首次加载无动画滚到底部
  const isInitialLoadRef = useRef(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['chatMessages', topic?.id],
    queryFn: () => (topic ? chatMessageService.getByTopic(topic.id) : Promise.resolve([])),
    enabled: !!topic,
  })

  const { data: notebooks = [] } = useQuery({
    queryKey: ['notebooks'],
    queryFn: () => notebookService.getTree(),
  })

  const { data: skills = [] } = useQuery({
    queryKey: ['skills'],
    queryFn: () => skillService.getAll(),
  })

  const { data: localSkills = [] } = useQuery({
    queryKey: ['localSkills'],
    queryFn: () => skillService.getLocalSkills(),
  })

  const { data: presets = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
  })

  const { data: localPresets = [] } = useQuery({
    queryKey: ['localPromptPresets'],
    queryFn: () => promptPresetService.getLocal(),
  })

  const { data: aiModels = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  // Slash command menu items (db skills + local skills + agents)
  const slashItems = useMemo(() => {
    const items: { key: string; label: string; description: string; icon: React.ReactNode; type: 'skill' | 'agent' }[] = []
    const seenNames = new Set<string>()
    for (const s of skills as Array<{ name: string; description?: string; isEnabled: boolean }>) {
      if (s.isEnabled && !seenNames.has(s.name)) {
        seenNames.add(s.name)
        items.push({ key: `skill:${s.name}`, label: `/${s.name}`, description: s.description || '', icon: <Zap size={14} className="text-violet-500" />, type: 'skill' })
      }
    }
    for (const s of localSkills as Array<{ name: string; description?: string; isEnabled: boolean }>) {
      if (s.isEnabled && !seenNames.has(s.name)) {
        seenNames.add(s.name)
        items.push({ key: `local:${s.name}`, label: `/${s.name}`, description: s.description || '', icon: <Zap size={14} className="text-violet-500" />, type: 'skill' })
      }
    }
    for (const p of presets as Array<{ id: string; name: string; category: string }>) {
      items.push({ key: `agent:${p.id}`, label: `/${p.name}`, description: p.category, icon: <Bot size={14} className="text-blue-500" />, type: 'agent' })
    }
    for (const p of localPresets as Array<{ id: string; name: string; category: string }>) {
      items.push({ key: `agent-local:${p.id}`, label: `/${p.name}`, description: p.category || '本地', icon: <Bot size={14} className="text-blue-500" />, type: 'agent' })
    }
    return items
  }, [skills, localSkills, presets, localPresets])

  const slashQuery = input.startsWith('/') && !input.includes(' ') ? input.slice(1).toLowerCase() : ''
  const showSlashMenu = !selectedSlashItem && slashQuery.length >= 0 && input.startsWith('/') && !input.includes(' ') && !isStreaming && slashItems.length > 0
  const filteredSlashItems = useMemo(() => {
    if (!showSlashMenu) return []
    if (!slashQuery) return slashItems
    return slashItems.filter(item =>
      item.label.toLowerCase().includes(slashQuery) || item.description.toLowerCase().includes(slashQuery)
    )
  }, [showSlashMenu, slashQuery, slashItems])

  // Reset slash menu index when items change, and auto-scroll selected item into view
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlashMenuIndex(0)
  }, [filteredSlashItems.length])

  useEffect(() => {
    slashItemRefs.current[slashMenuIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [slashMenuIndex])

  // 监听组件可见性，切换回此会话时滚到底部
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && messages.length > 0) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
        }
      }
    }, { threshold: 0.1 })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [messages.length])

  // 首次加载消息后直接滚到底部（无动画），后续新消息平滑滚动
  useEffect(() => {
    if (messagesLoading) return
    if (isInitialLoadRef.current && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
      isInitialLoadRef.current = false
      return
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingUserMessage, streamingContent, streamingThinking, streamingQuestions, streamingTodos, isOrganizing, organizeResult, messagesLoading])

  // Auto-scroll thinking block to bottom as thinking content streams in
  useEffect(() => {
    if (streamingThinking && showThinking) {
      thinkingEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [streamingThinking, showThinking])

  // Clear streaming display when messages are refreshed (after query invalidation).
  // The persisted message from the backend is the canonical response — once it arrives,
  // the streaming preview block should fully disappear.
  useEffect(() => {
    if (!topicId) return
    const s = useChatStreamStore.getState().streams[topicId]
    if (s && !s.isStreaming && (s.streamingContent || s.streamingThinking || s.searchResults.length > 0 || s.knowledgeResults.length > 0 || s.memoryResults.length > 0 || s.toolResults.length > 0 || s.questions.length > 0 || s.todos.length > 0)) {
      useChatStreamStore.getState().clearAfterPersist(topicId)
    }
    // Intentionally only react to messages list changes (post-stream refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (showAgentPicker && agentPickerRef.current && !agentPickerRef.current.contains(target)) {
        setShowAgentPicker(false)
      }
      if (showModelPicker && modelPickerRef.current && !modelPickerRef.current.contains(target)) {
        setShowModelPicker(false)
      }
      if (showReasoningPicker && reasoningPickerRef.current && !reasoningPickerRef.current.contains(target)) {
        setShowReasoningPicker(false)
      }
      if (showApprovalPicker && approvalPickerRef.current && !approvalPickerRef.current.contains(target)) {
        setShowApprovalPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAgentPicker, showModelPicker, showReasoningPicker, showApprovalPicker])

  const chatModels = aiModels.filter((model) => model.purpose === 'chat' && model.providerId)

  // Get current model's reasoning configuration
  const currentModel = selectedModelId ? chatModels.find(m => m.id === selectedModelId) : chatModels.find(m => m.isDefault) ?? chatModels[0]
  const currentReasoningMode = currentModel?.reasoningMode ?? 'none'
  const currentReasoningEffort = currentModel?.reasoningEffort ?? 'medium'

  // Sync reasoning effort from model when model changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReasoningEffort(currentReasoningEffort)
  }, [currentReasoningEffort])

  const toggleSavedThinking = useCallback((messageId: string) => {
    setExpandedThinking(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

  const copyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopiedMessageId(messageId)
    window.setTimeout(() => setCopiedMessageId(null), 1500)
  }, [])

  const submitAllAnswers = async () => {
    const toolCallId = streamingQuestions[0]?.toolCallId || ''
    const allAnswered = streamingQuestions.every(q => questionAnswers[q.id])
    if (!allAnswered) return

    // Build combined answer JSON
    const combined = streamingQuestions.map(q => ({
      id: q.id,
      question: q.question,
      answer: questionAnswers[q.id],
    }))

    // Mark as answered and clear state — do not render answers in the UI
    setStreamingQuestions([])
    setQuestionAnswers({})
    setCurrentQuestionIndex(0)

    try {
      await fetch('/api/chat-messages/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: topic?.id, toolCallId, answer: JSON.stringify(combined) }),
      })
    } catch (e) {
      console.error('Failed to submit answers:', e)
    }
  }

  const applyPreset = (preset: IPromptPreset) => {
    setSelectedPreset(prev => prev?.id === preset.id ? null : preset)
    setShowAgentPicker(false)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || !topic) return
    try {
      const results = await chatMessageService.search(searchQuery.trim(), topic.id)
      setSearchResults(results)
    } catch {
      setSearchResults([])
    }
  }

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const readSseStream = async (response: Response, onData: (data: string) => void): Promise<boolean> => {
    if (!response.body) return false
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let hasError = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data.startsWith('[ERROR]')) {
            hasError = true
          }
          onData(data)
        }
      }
    }
    return !hasError
  }

  const handleSend = async () => {
    if (!topic || (!input.trim() && !selectedSlashItem && attachedFiles.length === 0) || isStreaming) return

    const slashPrefix = selectedSlashItem ? selectedSlashItem.label + ' ' : ''
    const content = (slashPrefix + input.trim()).trim()
    setInput('')
    setSelectedSlashItem(null)
    startStreaming(topic.id, { content, webSearch, knowledgeBase, memory })

    const images: { data: string; mimeType: string; fileName?: string }[] = []
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        if (file.type.startsWith('image/')) {
          const base64 = await fileToBase64(file)
          images.push({ data: base64, mimeType: file.type, fileName: file.name })
        }
      }
    }
    setAttachedFiles([])

    // 如果选中了工作流，走工作流流式执行
    if (runningWorkflow) {
      setWorkflowNodes([])
      setWorkflowRunId('')
      setPendingApproval(null)
      setWorkflowToolCall(null)
      setWorkflowError('')
      const controller = new AbortController()
      try {
        await streamWorkflowRun(runningWorkflow.id, content, topic.id,
          (evt: IWorkflowEvent) => {
            switch (evt.type) {
              case 'run_started':
                if (evt.runId) setWorkflowRunId(evt.runId)
                break
              case 'node_started':
                setWorkflowNodes((prev) => {
                  const existing = prev.find(n => n.nodeId === evt.nodeId)
                  if (existing) return prev.map(n => n.nodeId === evt.nodeId ? { ...n, status: 'running' } : n)
                  return [...prev, { nodeId: evt.nodeId!, label: evt.label, nodeType: evt.nodeType, status: 'running' }]
                })
                break
              case 'node_completed':
                setWorkflowNodes((prev) => prev.map((n) => n.nodeId === evt.nodeId ? { ...n, status: 'success', output: evt.output } : n))
                break
              case 'node_failed':
                setWorkflowNodes((prev) => prev.map((n) => n.nodeId === evt.nodeId ? { ...n, status: 'failed', output: evt.error } : n))
                break
              case 'human_approval_required':
                setPendingApproval({ nodeId: evt.nodeId!, prompt: evt.prompt ?? '请确认是否继续执行', runId: evt.runId ?? workflowRunId })
                break
              case 'agent_tool_call':
                setWorkflowToolCall({ nodeId: evt.nodeId!, toolCallId: evt.toolCallId!, name: evt.name ?? '', arguments: evt.arguments ?? '{}' })
                break
              case 'run_completed':
                setStreamingContent(evt.output ?? '工作流执行完成')
                break
              case 'run_failed':
                setWorkflowError(evt.error ?? '')
                setStreamingContent('工作流执行失败：' + (evt.error ?? ''))
                break
              case 'run_result':
                if (evt.result?.error) setWorkflowError(evt.result.error)
                setStreamingContent(evt.result?.output ?? evt.result?.error ?? '工作流执行完成')
                break
            }
          },
          (err) => { setStreamingContent('工作流执行失败：' + err) },
          controller.signal)
      } catch { setStreamingContent('工作流执行异常') }
      finally { stopStreaming(topic.id) }
      queryClient.invalidateQueries({ queryKey: ['chatMessages', topic.id] })
      return
    }

    const skillMatch = content.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/)
    let detectedSkillName: string | undefined
    let detectedAgentId: string | undefined
    let detectedPresetContent: string | undefined
    if (skillMatch) {
      const name = skillMatch[1]
      const skill = skills.find((s) => s.name === name && s.isEnabled)
      const localSkill = localSkills.find((s) => s.name === name && s.isEnabled)
      if (skill || localSkill) detectedSkillName = name
      const preset = presets.find((p) => p.name.toLowerCase() === name.toLowerCase())
      if (preset) {
        detectedAgentId = preset.id
        detectedPresetContent = preset.content
      } else {
        const localPreset = localPresets.find((p) => p.name.toLowerCase() === name.toLowerCase())
        if (localPreset) detectedPresetContent = localPreset.content
      }
    }

    // 发起流并在后台消费；切换话题不中断（按 topicId 写入全局 store）
    void consumeChatStream(topic.id, (signal) =>
      chatMessageService.stream(topic.id, {
        content,
        modelId: selectedModelId || undefined,
        deepThinking,
        reasoningEffort: deepThinking ? reasoningEffort : undefined,
        webSearch, knowledgeBase, memory,
        presetSystemPrompt: detectedPresetContent || selectedPreset?.content || undefined,
        images: images.length > 0 ? images : undefined,
        skillName: detectedSkillName,
        agentId: detectedAgentId || selectedPreset?.id,
        enableTools: toolCalling,
        toolApprovalOverrides: toolApprovalMode !== 'auto' ? { '*': toolApprovalMode } : undefined,
      }, signal),
    ).finally(() => {
      queryClient.invalidateQueries({ queryKey: ['chatMessages', topic.id] })
    })
  }

  const handleStop = useCallback(() => {
    if (topicId) chatStreamControl.cancel(topicId)
  }, [topicId])

  const forkMutation = useMutation({
    mutationFn: ({ topicId, branchMessageId }: { topicId: string; branchMessageId?: string }) =>
      chatTopicService.fork(topicId, branchMessageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
    },
  })

  const updateMessageMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => chatMessageService.update(id, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatMessages', topic?.id] })
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      setEditingMessageId(null)
      setEditingContent('')
    },
  })

  const deleteMessageMutation = useMutation({
    mutationFn: (id: string) => chatMessageService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatMessages', topic?.id] })
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      setEditingMessageId(null)
      setEditingContent('')
    },
  })

  const startEditingMessage = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId)
    setEditingContent(content)
  }, [])

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null)
    setEditingContent('')
  }, [])

  const updateMessageMutate = updateMessageMutation.mutate
  const saveEditingMessage = useCallback(() => {
    if (!editingMessageId || !editingContent.trim()) return
    updateMessageMutate({ id: editingMessageId, content: editingContent.trim() })
  }, [editingMessageId, editingContent, updateMessageMutate])

  const deleteMessageMutate = deleteMessageMutation.mutate
  const deleteMessage = useCallback((messageId: string) => {
    confirm({ message: '确定删除这条消息吗？', onConfirm: () => deleteMessageMutate(messageId) })
  }, [confirm, deleteMessageMutate])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
    setAttachedFiles(prev => [...prev, ...imageFiles])
    e.target.value = ''
  }

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      setAttachedFiles(prev => [...prev, ...files])
    }
  }

  const handleApprove = async (toolCallId: string, approved: boolean) => {
    if (topicId) useChatStreamStore.getState().removeApproval(topicId, toolCallId)
    try {
      await fetch('/api/chat-messages/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: topic?.id, toolCallId, approve: approved }),
      })
    } catch {
      // Ignore — backend will timeout anyway
    }
  }

  // 工作流 Human 节点审批
  const handleWorkflowApprove = async (runId: string, nodeId: string, approve: boolean) => {
    setPendingApproval(null)
    try {
      await fetch(`/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, approve }),
      })
    } catch {
      // Ignore
    }
  }

  // 工作流 Agent 工具交互提交（复用 chat-messages 的 answer/approve 端点）
  const handleWorkflowToolApprove = async (approved: boolean, answer?: string) => {
    if (!workflowToolCall || !topic) return
    const sessionId = `workflow-${workflowRunId}-${workflowToolCall.nodeId}`
    setWorkflowToolCall(null)
    try {
      if (workflowToolCall.name === 'ask_question') {
        await fetch('/api/chat-messages/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, toolCallId: workflowToolCall.toolCallId, answer: answer ?? '' }),
        })
      } else {
        await fetch('/api/chat-messages/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, toolCallId: workflowToolCall.toolCallId, approve: approved }),
        })
      }
    } catch {
      // Ignore
    }
  }

  const handleOrganize = async () => {
    if (!topic || isOrganizing || isStreaming) return

    setIsOrganizing(true)
    setOrganizeResult(null)

    try {
      const response = await chatTopicService.organize(topic.id, {
        notebookId: organizeTargetNotebook || undefined,
        style: organizeStyle,
      })

      let preview = ''
      const success = await readSseStream(response, (data) => {
        if (data.startsWith('[DONE]')) {
          const noteId = data.slice(6)
          const title = preview.split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? '整理笔记'
          setOrganizeResult({ noteId, title })
          queryClient.invalidateQueries({ queryKey: ['notes'] })
          queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
          // 刷新当前话题状态
          chatTopicService.getById(topic.id).then(onTopicUpdated).catch(() => {})
        } else if (data.startsWith('[ERROR]')) {
          // ignore
        } else {
          // 尝试解析为 JSON（thinking/content 结构化事件）
          try {
            const chunk = JSON.parse(data)
            if (chunk.type === 'content') {
              preview += chunk.text
            }
            // thinking 类型忽略，不展示
          } catch {
            // 非 JSON，作为纯文本追加
            preview += data
          }
        }
      })

      if (!success) {
        console.warn('整理失败，请检查模型配置。')
      }
    } catch (error) {
      console.error('Organize error:', error)
    } finally {
      setIsOrganizing(false)
    }
  }

  if (!topic) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
            <Bot size={28} className="text-white" />
          </div>
          <p className="text-sm text-gray-400">选择一个话题开始对话</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-white dark:bg-gray-900 min-w-0">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{topic.title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{group ? `${group.name} · ` : ''}{messages.length} 条消息</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowSearch(!showSearch); if (showSearch) { setSearchQuery(''); setSearchResults([]) } }}
            className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'}`}
            title="搜索"
          >
            <Search size={15} />
          </button>
          <button
            onClick={() => topic && forkMutation.mutate({ topicId: topic.id })}
            disabled={messages.length === 0}
            className="p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="分支话题"
          >
            <GitBranch size={15} />
          </button>
          <button
            onClick={() => setShowOrganizeOptions(!showOrganizeOptions)}
            disabled={isOrganizing || isStreaming || messages.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed dark:text-emerald-400 dark:hover:bg-emerald-900/20"
          >
            <FileText size={14} />
            {isOrganizing ? '整理中...' : '整理笔记'}
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      {/* Organize options dropdown */}
      {/* Organizing status - shown at top */}
      {isOrganizing && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-800 dark:bg-emerald-900/20">
          <Loader2 size={14} className="animate-spin text-emerald-600" />
          <span className="text-sm text-emerald-700 dark:text-emerald-300">正在整理为笔记...</span>
        </div>
      )}
      {organizeResult && !isOrganizing && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-800 dark:bg-emerald-900/20">
          <Check size={14} className="text-emerald-600" />
          <span className="text-sm text-emerald-700 dark:text-emerald-300">已保存笔记：{organizeResult.title}</span>
        </div>
      )}

      {showOrganizeOptions && topic && (
        <div className="border-b border-gray-200 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-900/50">
          <div className="flex items-end gap-4">
            <div>
              <span className="mb-1 block text-[11px] text-gray-500">整理风格</span>
              <Select
                value={organizeStyle}
                onChange={(value) => setOrganizeStyle(value as typeof organizeStyle)}
                options={[
                  { value: 'summary', label: '摘要式' },
                  { value: 'detailed', label: '详细式' },
                  { value: 'qna', label: 'Q&A 式' },
                ]}
              />
            </div>
            <div className="flex-1 relative">
              <span className="mb-1 block text-[11px] text-gray-500">目标笔记本</span>
              <button
                type="button"
                onClick={() => setShowNotebookPicker(!showNotebookPicker)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-left flex items-center justify-between dark:border-gray-700 dark:bg-gray-800"
              >
                <span className="truncate">{organizeTargetNotebook ? findNotebookName(notebooks, organizeTargetNotebook) : '默认笔记本'}</span>
                <ChevronDown size={12} className="text-gray-400 shrink-0" />
              </button>
              {showNotebookPicker && (
                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  <button
                    type="button"
                    onClick={() => { setOrganizeTargetNotebook(''); setShowNotebookPicker(false) }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      !organizeTargetNotebook ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    默认笔记本
                  </button>
                  {renderNotebookTree(notebooks, 0, organizeTargetNotebook, (id) => {
                    setOrganizeTargetNotebook(id)
                    setShowNotebookPicker(false)
                  })}
                </div>
              )}
            </div>
            <button
              onClick={() => { setShowOrganizeOptions(false); handleOrganize() }}
              disabled={isOrganizing}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              开始整理
            </button>
            <button
              onClick={() => setShowOrganizeOptions(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {showSearch && (
        <div className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex gap-2 mb-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                placeholder="搜索话题中的消息..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 outline-none focus:border-indigo-400"
              />
            </div>
            <button onClick={handleSearch} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">搜索</button>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {searchResults.map(r => (
                <div key={r.id} className="p-2 text-xs bg-white dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2 text-gray-500">
                    <span className={`px-1 rounded ${r.role === 'user' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-gray-100 dark:bg-gray-800'}`}>{r.role === 'user' ? '我' : 'AI'}</span>
                    <span>{r.topicTitle}</span>
                  </div>
                  <p className="mt-1 text-gray-600 dark:text-gray-400 line-clamp-2">{r.contentSnippet}</p>
                </div>
              ))}
            </div>
          )}
          {searchQuery && searchResults.length === 0 && (
            <p className="text-xs text-gray-500">未找到匹配的消息</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center text-center py-20">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
              <Bot size={28} className="text-white" />
            </div>
            <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-gray-100">开始对话</h3>
            <p className="max-w-xs text-sm text-gray-500">在下方输入消息开始对话，或从左侧选择一个已有话题继续</p>
          </div>
        )}
        <div className="space-y-5">
          {messages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              assistantName={assistantName}
              isEditing={editingMessageId === message.id}
              editingContent={editingMessageId === message.id ? editingContent : ''}
              isCopied={copiedMessageId === message.id}
              thinkingExpanded={expandedThinking.has(message.id)}
              actionsDisabled={isStreaming || updateMessageMutation.isPending || deleteMessageMutation.isPending}
              onToggleThinking={toggleSavedThinking}
              onCopy={copyMessage}
              onStartEdit={startEditingMessage}
              onSaveEdit={saveEditingMessage}
              onCancelEdit={cancelEditingMessage}
              onDelete={deleteMessage}
              onEditContentChange={setEditingContent}
            />
          ))}
        </div>

        {/* Pending user message (shown until the message sent at/after stream start is persisted) */}
        {pendingUserMessage && !messages.some((m) => m.role === 'user' && new Date(m.createdAt).getTime() >= streamStartedAt - 2000) && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm">
              <span className="text-xs font-bold">U</span>
            </div>
            <div className="w-full flex flex-col">
              <div className="mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">你</span>
              </div>
              <div className="rounded-2xl rounded-tr-sm bg-blue-50 px-4 py-3 text-sm text-gray-900 dark:bg-blue-950/40 dark:text-gray-100">
                {pendingUserMessage}
              </div>
            </div>
          </div>
        )}

        {/* Streaming response - show during and after stream until messages refresh */}
        {(isStreaming || streamingContent || streamingThinking || streamingToolCalls.length > 0 || streamingSearchResults.length > 0 || streamingKnowledgeResults.length > 0 || streamingMemoryResults.length > 0 || streamingToolResults.length > 0 || streamingQuestions.length > 0 || streamingTodos.length > 0) && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Bot size={15} />
            </div>
            <div className="w-full flex flex-col">
              <div className="mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{assistantName}</span>
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3 dark:bg-gray-800">
                {/* Thinking block - show whenever thinking content exists */}
                {streamingThinking && (
                  <div className="mb-3">
                    <button
                      onClick={() => setShowThinking(!showThinking)}
                      className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <Brain size={12} />
                      <span>深度思考</span>
                      <ChevronDown size={10} className={`transition-transform ${showThinking ? 'rotate-180' : ''}`} />
                    </button>
                    {showThinking && (
                      <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-400 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-500">
                        <ThemedMarkdown source={streamingThinking} />
                        <div ref={thinkingEndRef} />
                      </div>
                    )}
                  </div>
                )}
                {/* Content */}
                {streamingContent && (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ThemedMarkdown source={streamingContent} />
                  </div>
                )}
                {/* Tool calls and results during streaming */}
                <ToolCallsPanel toolCalls={streamingToolCalls} toolResults={streamingToolResults} />
                {/* Search results citations - show when web search was used */}
                {(streamWebSearch || streamingSearchResults.length > 0) && streamingSearchResults.length > 0 && (
                  <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-400">
                      <Search size={11} />
                      参考来源
                    </div>
                    <div className="space-y-1">
                      {streamingSearchResults.map((r, i) => (
                        <a
                          key={i}
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-blue-100 text-[9px] font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-blue-600 dark:text-blue-400">{r.title}</span>
                            <span className="block truncate text-gray-400">{r.url}</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {/* Knowledge base results - show when knowledge base was used */}
                {(streamKnowledgeBase || streamingKnowledgeResults.length > 0) && streamingKnowledgeResults.length > 0 && (
                  <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-400">
                      <Database size={11} />
                      知识库参考
                    </div>
                    <div className="space-y-1">
                      {streamingKnowledgeResults.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-amber-100 text-[9px] font-bold text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-amber-600 dark:text-amber-400">{r.title}</span>
                            {r.contentSnippet && (
                              <span className="block truncate text-gray-400">{r.contentSnippet.slice(0, 80)}{r.contentSnippet.length > 80 ? '...' : ''}</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Memory results - show when memory was used */}
                {(streamMemory || streamingMemoryResults.length > 0) && streamingMemoryResults.length > 0 && (
                  <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-400">
                      <Atom size={11} />
                      记忆参考
                    </div>
                    <div className="space-y-1">
                      {streamingMemoryResults.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-teal-100 text-[9px] font-bold text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            {r.category && <span className="mr-1 font-medium text-teal-600 dark:text-teal-400">[{r.category}]</span>}
                            <span className="text-gray-600 dark:text-gray-300">{r.content}</span>
                            {r.score != null && (
                              <span className="ml-1 text-[10px] text-gray-400">({(r.score * 100).toFixed(0)}%)</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Loading dots - show only when streaming and no content yet */}
                {!streamingContent && !streamingThinking && isStreaming && (
                  <div className="flex items-center gap-1.5 py-1">
                    <Loader2 size={12} className="animate-spin text-gray-400" />
                    <span className="text-[11px] text-gray-400">思考中...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-100 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        {selectedPreset && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-900/20">
            <Bot size={14} className="text-indigo-500" />
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">智能体：{selectedPreset.name}</span>
            <button onClick={() => setSelectedPreset(null)} className="ml-auto text-indigo-400 hover:text-indigo-600"><X size={14} /></button>
          </div>
        )}
        {runningWorkflow && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
            <GitBranch size={14} className="text-blue-500" />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">工作流：{runningWorkflow.name}</span>
            <button onClick={() => setRunningWorkflow(null)} className="ml-auto text-blue-400 hover:text-blue-600"><X size={14} /></button>
          </div>
        )}
        {/* 工作流独立面板：流程图 + 状态 + 交互 */}
        {runningWorkflow && workflowNodes.length > 0 && (
          <div className="mb-3">
            <InlineWorkflowPanel
              workflow={runningWorkflow}
              nodeStates={workflowNodes}
              pendingApproval={pendingApproval}
              workflowToolCall={workflowToolCall}
              onApprove={handleWorkflowApprove}
              onToolApprove={handleWorkflowToolApprove}
              isStreaming={isStreaming}
              error={workflowError}
            />
          </div>
        )}
        {/* Approval request panel */}
        <ApprovalPanel requests={approvalRequests} onApprove={handleApprove} />
        {/* Todo progress panel - fixed above input */}
        <TodoPanel todos={streamingTodos} collapsed={todoPanelCollapsed} onToggleCollapsed={setTodoPanelCollapsed} />

        {/* Ask question panel - sequential one-at-a-time mode */}
        <QuestionPanel
          questions={streamingQuestions}
          answers={questionAnswers}
          currentIndex={currentQuestionIndex}
          onAnswer={setQuestionAnswers}
          onIndexChange={setCurrentQuestionIndex}
          onSubmitAll={submitAllAnswers}
        />

        {/* Attached files */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800">
                <FileText size={12} className="text-blue-500" />
                <span className="max-w-[120px] truncate text-gray-700 dark:text-gray-300">{file.name}</span>
                <button onClick={() => removeAttachedFile(i)} className="text-gray-400 hover:text-red-500"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="relative rounded-xl border border-gray-200 bg-white transition-colors focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:focus-within:border-blue-500">
          {/* Slash command menu */}
          {showSlashMenu && filteredSlashItems.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                输入 / 选择技能或智能体
              </div>
              {filteredSlashItems.map((item, i) => (
                <button
                  key={item.key}
                  ref={el => { slashItemRefs.current[i] = el }}
                  onClick={() => {
                    setSelectedSlashItem({ label: item.label, icon: item.icon, type: item.type, description: item.description })
                    setInput('')
                    textareaRef.current?.focus()
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                    i === slashMenuIndex
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{item.label}</div>
                    <div className="truncate text-[11px] text-gray-400">{item.description}</div>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    item.type === 'skill'
                      ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                      : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}>
                    {item.type === 'skill' ? '技能' : '智能体'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {/* Selected slash command chip */}
          {selectedSlashItem && (
            <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5">
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${
                selectedSlashItem.type === 'skill'
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              }`}>
                <span>{selectedSlashItem.icon}</span>
                <span>{selectedSlashItem.label}</span>
                <button
                  onClick={() => setSelectedSlashItem(null)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <X size={10} />
                </button>
              </span>
            </div>
          )}
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (showSlashMenu && filteredSlashItems.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSlashMenuIndex(i => (i + 1) % filteredSlashItems.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSlashMenuIndex(i => (i - 1 + filteredSlashItems.length) % filteredSlashItems.length)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const selected = filteredSlashItems[slashMenuIndex]
                  if (selected) {
                    setSelectedSlashItem({ label: selected.label, icon: selected.icon, type: selected.type, description: selected.description })
                    setInput('')
                  }
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setInput('')
                  return
                }
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const selected = filteredSlashItems[slashMenuIndex]
                  if (selected) {
                    setSelectedSlashItem({ label: selected.label, icon: selected.icon, type: selected.type, description: selected.description })
                    setInput('')
                  }
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            onPaste={handlePaste}
            placeholder={
              selectedSlashItem
                ? (selectedSlashItem.description || '输入内容...')
                : attachedFiles.length > 0
                  ? `已附加 ${attachedFiles.length} 张图片，输入消息...`
                  : "输入消息，Enter 发送，/ 选择技能..."
            }
            rows={2}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            {/* Left tools */}
            <div className="flex items-center gap-0.5">
              {/* Attach file (only for vision-capable models) */}
              {currentModel?.supportsVision && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  title="附加图片"
                >
                  <Plus size={16} />
                </button>
              )}
              <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleFileSelect} />

              {/* Agent selector — 智能体 + 工作流合并 */}
              <div className="relative" ref={agentPickerRef}>
                <button
                  onClick={() => { setShowAgentPicker(!showAgentPicker); setShowModelPicker(false) }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    selectedPreset || runningWorkflow
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                  }`}
                  title="智能体 / 工作流"
                >
                  {runningWorkflow ? <GitBranch size={14} /> : <Bot size={14} />}
                  {runningWorkflow ? runningWorkflow.name : selectedPreset ? selectedPreset.name : '智能体'}
                  <ChevronDown size={10} />
                </button>
                {showAgentPicker && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {/* 智能体分组 */}
                      <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">智能体</div>
                      {presets.length === 0 && localPresets.length === 0 ? (
                        <div className="p-3 text-center text-xs text-gray-500">暂无智能体</div>
                      ) : (
                        <>
                          {presets.map(p => (
                            <button
                              key={p.id}
                              onClick={() => { setRunningWorkflow(null); applyPreset(p); setShowAgentPicker(false) }}
                              title={p.content.slice(0, 120)}
                              className={`w-full rounded-lg px-3 py-1.5 text-left ${selectedPreset?.id === p.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                            >
                              <div className="flex items-center gap-2">
                                <Bot size={12} className="shrink-0 text-indigo-400" />
                                <span className={`text-xs font-medium ${selectedPreset?.id === p.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-800 dark:text-gray-200'}`}>{p.name}</span>
                                {selectedPreset?.id === p.id && <Check size={12} className="text-indigo-500" />}
                              </div>
                            </button>
                          ))}
                          {localPresets.length > 0 && presets.length > 0 && (
                            <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                          )}
                          {localPresets.map(p => {
                            const pseudo: IPromptPreset = {
                              id: p.id,
                              category: p.category || '本地',
                              name: p.name,
                              content: p.content,
                              variables: p.variables,
                              toolsConfig: p.toolsConfig,
                              isBuiltIn: false,
                              sortOrder: 0,
                              createdAt: '',
                              updatedAt: '',
                            }
                            return (
                              <button
                                key={p.id}
                                onClick={() => { setRunningWorkflow(null); applyPreset(pseudo); setShowAgentPicker(false) }}
                                title={p.content.slice(0, 120)}
                                className={`w-full rounded-lg px-3 py-1.5 text-left ${selectedPreset?.id === p.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                              >
                                <div className="flex items-center gap-2">
                                  <Bot size={12} className="shrink-0 text-indigo-400" />
                                  <span className={`text-xs font-medium ${selectedPreset?.id === p.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-800 dark:text-gray-200'}`}>{p.name}</span>
                                  <span className="rounded bg-amber-100 px-1 text-[9px] text-amber-600 dark:bg-amber-900/30">本地</span>
                                  {selectedPreset?.id === p.id && <Check size={12} className="text-indigo-500" />}
                                </div>
                              </button>
                            )
                          })}
                        </>
                      )}
                      {/* 工作流分组 */}
                      {(presets.length > 0 || localPresets.length > 0) && (
                        <div className="mb-1 mt-2 border-t border-gray-100 pt-2 dark:border-gray-700" />
                      )}
                      <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">工作流</div>
                      {availableWorkflows.length === 0 ? (
                        <div className="p-3 text-center text-xs text-gray-500">暂无工作流</div>
                      ) : (
                        availableWorkflows.map((w) => (
                          <button
                            key={w.id}
                            onClick={() => { setSelectedPreset(null); setRunningWorkflow(w); setShowAgentPicker(false) }}
                            title={w.description}
                            className={`w-full rounded-lg px-3 py-1.5 text-left ${runningWorkflow?.id === w.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          >
                            <div className="flex items-center gap-2">
                              <GitBranch size={12} className="shrink-0 text-blue-500" />
                              <span className={`text-xs font-medium ${runningWorkflow?.id === w.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-800 dark:text-gray-200'}`}>{w.name}</span>
                              {runningWorkflow?.id === w.id && <Check size={12} className="text-indigo-500" />}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Model selector */}
              <div className="relative" ref={modelPickerRef}>
                <button
                  onClick={() => { setShowModelPicker(!showModelPicker); setShowAgentPicker(false) }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    selectedModelId
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                  }`}
                  title="选择模型"
                >
                  {selectedModelId ? chatModels.find(m => m.id === selectedModelId)?.displayName || '默认模型' : '默认模型'}
                  <ChevronDown size={10} />
                </button>
                {showModelPicker && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
                    <div className="max-h-48 overflow-y-auto p-1.5">
                      <button
                        onClick={() => { setSelectedModelId(''); setShowModelPicker(false) }}
                        className={`w-full rounded-lg px-3 py-2 text-left text-xs ${!selectedModelId ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                      >
                        默认模型
                      </button>
                      {chatModels.map(m => (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedModelId(m.id); setShowModelPicker(false) }}
                          className={`w-full rounded-lg px-3 py-2 text-left text-xs ${selectedModelId === m.id ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                        >
                          {m.displayName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />

              {/* Tool calling toggle + approval picker */}
              <div className="relative flex items-center" ref={approvalPickerRef}>
                {toolCalling && (
                  <button
                    onClick={() => setShowApprovalPicker(!showApprovalPicker)}
                    className={`flex items-center gap-0.5 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors ${
                      toolApprovalMode === 'ask'
                        ? 'text-blue-500'
                        : toolApprovalMode === 'bypass'
                          ? 'text-red-500'
                          : 'text-amber-500'
                    } hover:bg-gray-100 dark:hover:bg-gray-700`}
                    title="审批模式"
                  >
                    {toolApprovalMode === 'ask' ? '询问' : toolApprovalMode === 'bypass' ? '静默' : '自动'}
                    <ChevronDown size={10} />
                  </button>
                )}
                <button
                  onClick={() => setToolCalling(!toolCalling)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    toolCalling
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                  }`}
                  title="工具调用"
                >
                  <Zap size={14} />
                  工具
                </button>
                {showApprovalPicker && (
                  <div className="absolute bottom-full left-0 z-50 mb-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">审批模式</div>
                    {([
                      { value: 'auto', label: '自动执行', desc: '工具自动运行，结果正常展示', color: 'text-amber-600 dark:text-amber-400' },
                      { value: 'ask', label: '询问确认', desc: '执行前暂停等待确认', color: 'text-blue-600 dark:text-blue-400' },
                      { value: 'bypass', label: '静默执行', desc: '工具自动运行，结果折叠', color: 'text-red-600 dark:text-red-400' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setToolApprovalMode(opt.value); setShowApprovalPicker(false) }}
                        className={`flex w-full flex-col px-3 py-1.5 text-left transition-colors ${
                          toolApprovalMode === opt.value
                            ? 'bg-gray-100 dark:bg-gray-700/50'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        <span className={`text-xs font-medium ${opt.color}`}>{opt.label}</span>
                        <span className="text-[10px] text-gray-400">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />

              {/* Deep thinking - dynamic based on model reasoning mode */}
              {currentReasoningMode === 'tag' && (
                <button
                  onClick={() => setDeepThinking(!deepThinking)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    deepThinking
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                  }`}
                  title="深度思考"
                >
                  <Brain size={14} />
                  深度思考
                </button>
              )}
              {currentReasoningMode === 'native' && (
                <div className="relative" ref={reasoningPickerRef}>
                  <button
                    onClick={() => setShowReasoningPicker(!showReasoningPicker)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      deepThinking
                        ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                        : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                    }`}
                    title="推理强度"
                  >
                    <Brain size={14} />
                    {reasoningEffort === 'low' ? '低' : reasoningEffort === 'high' ? '高' : reasoningEffort === 'off' ? '关闭' : '中'}
                    <ChevronDown size={10} />
                  </button>
                  {showReasoningPicker && (
                    <div className="absolute bottom-full left-0 mb-2 w-32 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
                      <div className="p-1.5">
                        {['low', 'medium', 'high'].map(level => (
                          <button
                            key={level}
                            onClick={() => { setReasoningEffort(level); setDeepThinking(true); setShowReasoningPicker(false) }}
                            className={`w-full rounded-lg px-3 py-1.5 text-left text-xs ${reasoningEffort === level ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          >
                            {level === 'low' ? '低强度' : level === 'medium' ? '中等' : '高强度'}
                          </button>
                        ))}
                        <button
                          onClick={() => { setDeepThinking(false); setShowReasoningPicker(false) }}
                          className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Web search toggle */}
              <button
                onClick={() => setWebSearch(!webSearch)}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  webSearch
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                }`}
                title="网络搜索"
              >
                <Globe size={14} />
                网络搜索
              </button>

              {/* Knowledge base toggle */}
              <button
                onClick={() => setKnowledgeBase(!knowledgeBase)}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  knowledgeBase
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                }`}
                title="知识库"
              >
                <Database size={14} />
                知识库
              </button>

              {/* Memory toggle */}
              <button
                onClick={() => setMemory(!memory)}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  memory
                    ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                }`}
                title="记忆"
              >
                <Atom size={14} />
                记忆
              </button>
            </div>

            {/* Send / Stop button */}
            {isStreaming ? (
              <button
                onClick={handleStop}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-white shadow-sm transition-all hover:bg-red-600"
                title="停止生成"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && attachedFiles.length === 0}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>

        <p className="mt-1.5 text-center text-[10px] text-gray-400">Shift + Enter 换行 · 支持粘贴文件</p>
      </div>
    </div>
  )
}