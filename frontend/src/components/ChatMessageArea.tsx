import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, FileText, Sparkles, Search, GitBranch, Settings, Copy, Check, Pencil, Trash2, X, Save, RotateCcw, Plus, Brain, Globe, Database, ChevronDown, ChevronLeft, ChevronRight, Loader2, Atom, Zap, ClipboardList, CircleDashed, CircleCheckBig, Circle, HelpCircle } from 'lucide-react'
import { chatMessageService, chatTopicService, promptPresetService } from '../services/chatService'
import type { ChatMessageSearchResult } from '../services/chatService'
import { notebookService } from '../services/notebookService'
import { skillService } from '../services/skillService'
import { aiModelService } from '../services/aiProviderService'
import ThemedMarkdown from './ThemedMarkdown'
import type { IChatTopic, IPromptPreset, INotebook } from '../types'

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

export default function ChatMessageArea({ topic, group, onTopicUpdated }: ChatMessageAreaProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingSearchResults, setStreamingSearchResults] = useState<Array<{ title: string; url: string; snippet: string }>>([])
  const [showThinking, setShowThinking] = useState(false)
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null)
  const [streamDeepThinking, setStreamDeepThinking] = useState(false)
  const [streamWebSearch, setStreamWebSearch] = useState(false)
  const [streamKnowledgeBase, setStreamKnowledgeBase] = useState(false)
  const [streamMemory, setStreamMemory] = useState(false)
  const [streamingKnowledgeResults, setStreamingKnowledgeResults] = useState<Array<{ title: string; contentSnippet: string; id: string }>>([])
  const [streamingMemoryResults, setStreamingMemoryResults] = useState<Array<{ id: string; content: string; category?: string; score?: number }>>([])
  const [streamingToolCalls, setStreamingToolCalls] = useState<{id: string; name: string; arguments: string}[]>([])
  const [streamingToolResults, setStreamingToolResults] = useState<{name: string; content: string; isError?: boolean; collapsed?: boolean}[]>([])
  const [streamingQuestions, setStreamingQuestions] = useState<Array<{
    id: string
    toolCallId: string
    header: string
    question: string
    options?: Array<{ label: string; description?: string }>
    allowCustom?: boolean
    answered: boolean
    answer?: string
  }>>([])
  const [streamingTodos, setStreamingTodos] = useState<Array<{
    id: string
    title: string
    description?: string
    status: 'not-started' | 'in-progress' | 'completed'
  }>>([])
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isOrganizing, setIsOrganizing] = useState(false)
  const [organizePreview, setOrganizePreview] = useState('')
  const [organizeStyle, setOrganizeStyle] = useState<'summary' | 'detailed' | 'qna'>('summary')
  const [organizeTargetNotebook, setOrganizeTargetNotebook] = useState('')
  const [organizeResult, setOrganizeResult] = useState<{ noteId: string; title: string } | null>(null)
  const [showOrganizeOptions, setShowOrganizeOptions] = useState(false)
  const [showNotebookPicker, setShowNotebookPicker] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<IPromptPreset | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChatMessageSearchResult[]>([])
  const [showAutoOrganizeSettings, setShowAutoOrganizeSettings] = useState(false)
  const [showTopicSettings, setShowTopicSettings] = useState(false)
  const [topicModelId, setTopicModelId] = useState('')
  const [topicSystemPrompt, setTopicSystemPrompt] = useState('')
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

  const { data: messages = [] } = useQuery({
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
    return items
  }, [skills, localSkills, presets])

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
    setSlashMenuIndex(0)
  }, [filteredSlashItems.length])

  useEffect(() => {
    slashItemRefs.current[slashMenuIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [slashMenuIndex])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingUserMessage, streamingContent, streamingThinking, streamingQuestions, streamingTodos, isOrganizing, organizeResult])

  // Auto-scroll thinking block to bottom as thinking content streams in
  useEffect(() => {
    if (streamingThinking && showThinking) {
      thinkingEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [streamingThinking, showThinking])

  // Clear streaming text/thinking display when messages are refreshed (after query invalidation).
  // Auxiliary panels (todos, questions, tool calls) are preserved until the next send — they
  // are not saved into messages and should remain visible after the stream ends.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isStreaming && (streamingContent || streamingThinking || streamingSearchResults.length > 0)) {
      setStreamingContent('')
      setStreamingThinking('')
      setStreamingSearchResults([])
      setShowThinking(false)
      setStreamWebSearch(false)
      setStreamDeepThinking(false)
    }
  }, [messages])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setTopicModelId(topic?.modelId ?? '')
    setTopicSystemPrompt(topic?.customSystemPrompt ?? '')
  }, [topic?.id, topic?.modelId, topic?.customSystemPrompt])
  /* eslint-enable react-hooks/set-state-in-effect */

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
    setReasoningEffort(currentReasoningEffort)
  }, [currentReasoningEffort])

  const toggleSavedThinking = (messageId: string) => {
    setExpandedThinking(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  const copyMessage = async (messageId: string, content: string) => {
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
  }

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
        body: JSON.stringify({ toolCallId, answer: JSON.stringify(combined) }),
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

    // Combine selected slash chip with input
    const slashPrefix = selectedSlashItem ? selectedSlashItem.label + ' ' : ''
    const content = (slashPrefix + input.trim()).trim()
    setInput('')
    setSelectedSlashItem(null)
    setIsStreaming(true)
    setStreamingContent('')
    setStreamingThinking('')
    setStreamingSearchResults([])
    setPendingUserMessage(content)
    setStreamDeepThinking(deepThinking)
    setStreamWebSearch(webSearch)
    setStreamKnowledgeBase(knowledgeBase)
    setStreamMemory(memory)
    setStreamingKnowledgeResults([])
    setStreamingMemoryResults([])
    setStreamingToolCalls([])
    setStreamingToolResults([])
    setStreamingQuestions([])
    setStreamingTodos([])
    setQuestionAnswers({})
    setCurrentQuestionIndex(0)

    // Convert attached files to base64
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

    // Detect /skill command
    const skillMatch = content.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/)
    let detectedSkillName: string | undefined
    let detectedAgentId: string | undefined
    if (skillMatch) {
      const name = skillMatch[1]
      // Check if it's a skill
      const skill = skills.find((s) => s.name === name && s.isEnabled)
      if (skill) {
        detectedSkillName = name
      }
      // Check if it's an agent/preset (by name match)
      const preset = presets.find((p) => p.name.toLowerCase() === name.toLowerCase())
      if (preset) {
        detectedAgentId = preset.id
        // Apply preset system prompt
        if (!selectedPreset) {
          // Could auto-select the preset, but for now just pass the ID
        }
      }
    }

    try {
      const response = await chatMessageService.stream(topic.id, {
        content,
        modelId: selectedModelId || undefined,
        deepThinking,
        reasoningEffort: deepThinking ? reasoningEffort : undefined,
        webSearch,
        knowledgeBase,
        memory,
        presetSystemPrompt: selectedPreset?.content || undefined,
        images: images.length > 0 ? images : undefined,
        skillName: detectedSkillName,
        agentId: detectedAgentId || selectedPreset?.id,
        enableTools: toolCalling,
        toolApprovalOverrides: toolApprovalMode !== 'auto' ? { '*': toolApprovalMode } : undefined,
      })
      await readSseStream(response, (data) => {
        if (data.startsWith('[ERROR]')) {
          setStreamingContent((prev) => prev + '\n' + data)
          return
        }
        try {
          const chunk = JSON.parse(data)
          if (chunk.type === 'thinking') {
            setStreamingThinking(prev => prev + chunk.text)
            setShowThinking(true) // Auto-expand when thinking content arrives
          } else if (chunk.type === 'content') {
            setStreamingContent(prev => prev + chunk.text)
          } else if (chunk.type === 'search_results') {
            setStreamingSearchResults(chunk.results || [])
          } else if (chunk.type === 'knowledge_results') {
            setStreamingKnowledgeResults(chunk.results || [])
          } else if (chunk.type === 'memory_results') {
            setStreamingMemoryResults(chunk.results || [])
          } else if (chunk.type === 'tool_call') {
            if (!chunk.hidden) {
              setStreamingToolCalls(prev => [...prev, { id: chunk.id, name: chunk.name, arguments: chunk.arguments }])
            }
          } else if (chunk.type === 'tool_result') {
            if (!chunk.hidden) {
              setStreamingToolResults(prev => [...prev, { name: chunk.name, content: chunk.content, isError: chunk.isError, collapsed: chunk.collapsed }])
            }
          } else if (chunk.type === 'approval_request') {
            // For now, auto-approve. In the future, show a confirmation UI.
            console.log('Approval request:', chunk.name, chunk.arguments)
          } else if (chunk.type === 'question') {
            try {
              const questionData = typeof chunk.data === 'string' ? JSON.parse(chunk.data) : chunk.data
              if (questionData?.questions) {
                const newQuestions = questionData.questions.map((q: any, i: number) => ({
                  id: `${chunk.toolCallId || 'q'}_${i}`,
                  toolCallId: chunk.toolCallId || '',
                  header: q.header || '问题',
                  question: q.question || '',
                  options: q.options,
                  allowCustom: q.allowCustom !== false,
                  answered: false,
                  answer: undefined,
                }))
                setStreamingQuestions(prev => [...prev, ...newQuestions])
              }
            } catch {}
          } else if (chunk.type === 'todo') {
            try {
              const todoData = typeof chunk.data === 'string' ? JSON.parse(chunk.data) : chunk.data
              // Prefer the full authoritative list from the backend
              if (Array.isArray(todoData?.todos) && todoData.todos.length > 0) {
                setStreamingTodos(todoData.todos.map((t: any) => ({
                  id: t.id || `t${Math.random().toString(36).slice(2)}`,
                  title: t.title || '',
                  description: t.description,
                  status: (t.status as 'not-started' | 'in-progress' | 'completed') || 'not-started',
                })))
              } else if (todoData?.action === 'create' && todoData?.title) {
                setStreamingTodos(prev => [...prev, {
                  id: todoData.id || `t${prev.length + 1}`,
                  title: todoData.title,
                  description: todoData.description,
                  status: todoData.status || 'not-started',
                }])
              } else if (todoData?.action === 'update' && todoData?.id) {
                setStreamingTodos(prev => prev.map(t =>
                  t.id === todoData.id ? { ...t, status: todoData.status || t.status } : t
                ))
              } else if (todoData?.action === 'complete' && todoData?.id) {
                setStreamingTodos(prev => prev.map(t =>
                  t.id === todoData.id ? { ...t, status: 'completed' } : t
                ))
              }
            } catch {}
          }
        } catch {
          // Fallback: treat as plain text (backward compat)
          setStreamingContent(prev => prev + data)
        }
      })
      queryClient.invalidateQueries({ queryKey: ['chatMessages', topic.id] })
    } catch (error) {
      console.error('Stream error:', error)
      setStreamingContent('流式输出失败，请检查模型配置。')
    } finally {
      setIsStreaming(false)
      setPendingUserMessage(null)
    }
  }

  const forkMutation = useMutation({
    mutationFn: ({ topicId, branchMessageId }: { topicId: string; branchMessageId?: string }) =>
      chatTopicService.fork(topicId, branchMessageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
    },
  })

  const updateTopicSettingsMutation = useMutation({
    mutationFn: () => {
      return chatTopicService.update(topic!.id, {
        title: topic!.title,
        modelId: topicModelId || undefined,
        customSystemPrompt: topicSystemPrompt.trim() || undefined,
        noteSyncStatus: topic!.noteSyncStatus,
        isAutoOrganizeEnabled: topic!.isAutoOrganizeEnabled,
        autoOrganizeNotebookId: topic!.autoOrganizeNotebookId,
      })
    },
    onSuccess: (updatedTopic) => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      onTopicUpdated?.(updatedTopic)
      setShowTopicSettings(false)
    },
  })

  const updateAutoOrganizeMutation = useMutation({
    mutationFn: ({ enabled, notebookId }: { enabled: boolean; notebookId?: string }) =>
      chatTopicService.update(topic!.id, {
        title: topic!.title,
        modelId: topic!.modelId,
        customSystemPrompt: topic!.customSystemPrompt,
        contextWindowSize: topic!.contextWindowSize,
        noteSyncStatus: topic!.noteSyncStatus,
        isAutoOrganizeEnabled: enabled,
        autoOrganizeNotebookId: notebookId || undefined,
      }),
    onSuccess: (updatedTopic) => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      onTopicUpdated?.(updatedTopic)
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

  const startEditingMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId)
    setEditingContent(content)
  }

  const saveEditingMessage = () => {
    if (!editingMessageId || !editingContent.trim()) return
    updateMessageMutation.mutate({ id: editingMessageId, content: editingContent.trim() })
  }

  const deleteMessage = (messageId: string) => {
    if (!window.confirm('确定删除这条消息吗？')) return
    deleteMessageMutation.mutate(messageId)
  }

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

  const handleOrganize = async () => {
    if (!topic || isOrganizing || isStreaming) return

    setIsOrganizing(true)
    setOrganizePreview('')
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
        setOrganizePreview((prev) => prev || '整理失败，请检查模型配置。')
      }
    } catch (error) {
      console.error('Organize error:', error)
      setOrganizePreview('整理失败，请检查模型配置。')
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
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 min-w-0">
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
              <select
                value={organizeStyle}
                onChange={(e) => setOrganizeStyle(e.target.value as typeof organizeStyle)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="summary">摘要式</option>
                <option value="detailed">详细式</option>
                <option value="qna">Q&A 式</option>
              </select>
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
          <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${message.role === 'user' ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
              {message.role === 'user' ? <span className="text-xs font-bold">U</span> : <Bot size={15} />}
            </div>
            <div className={`flex min-w-0 max-w-[80%] flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className="mb-1.5 flex items-center gap-2">
                {message.role === 'assistant' && (
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">AI 助手</span>
                )}
                <span className="text-xs text-gray-400">{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>

                {message.role === 'user' && (
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">你</span>
                )}
              </div>
              <div className={`group relative rounded-2xl px-4 py-3 ${message.role === 'user' ? 'rounded-tr-sm bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm' : 'rounded-tl-sm bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'}`}>
                {editingMessageId === message.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="w-full min-h-28 rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-900 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => { setEditingMessageId(null); setEditingContent('') }}
                        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <X size={14} />
                      </button>
                      <button
                        onClick={saveEditingMessage}
                        disabled={!editingContent.trim() || updateMessageMutation.isPending}
                        className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Thinking block for saved messages */}
                    {message.role === 'assistant' && message.thinkingContent && (
                      <div className="mb-3">
                        <button
                          onClick={() => toggleSavedThinking(message.id)}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          <Brain size={12} />
                          <span>深度思考</span>
                          <ChevronDown size={10} className={`transition-transform ${expandedThinking.has(message.id) ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedThinking.has(message.id) && (
                          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-400 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-500">
                            <ThemedMarkdown source={message.thinkingContent} />
                          </div>
                        )}
                      </div>
                    )}
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ThemedMarkdown source={message.content} />
                    </div>
                    {/* Search results for saved messages */}
                    {message.role === 'assistant' && message.searchResultsJson && (() => {
                      try {
                        const results = JSON.parse(message.searchResultsJson) as Array<{ title: string; url: string; snippet: string }>
                        if (results.length === 0) return null
                        return (
                          <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-400">
                              <Search size={11} />
                              参考来源
                            </div>
                            <div className="space-y-1">
                              {results.map((r, i) => (
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
                        )
                      } catch { return null }
                    })()}
                  </>
                )}
                {!editingMessageId && (
                  <div className={`absolute -top-3 ${message.role === 'user' ? 'left-0' : 'right-0'} opacity-0 transition-opacity group-hover:opacity-100 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800`}>
                    <button
                      onClick={() => copyMessage(message.id, message.content)}
                      className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="复制"
                    >
                      {copiedMessageId === message.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    </button>
                    <button
                      onClick={() => startEditingMessage(message.id, message.content)}
                      disabled={isStreaming || updateMessageMutation.isPending || deleteMessageMutation.isPending}
                      className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-50 dark:hover:text-gray-300"
                      title="编辑"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => deleteMessage(message.id)}
                      disabled={isStreaming || updateMessageMutation.isPending || deleteMessageMutation.isPending}
                      className="p-1 rounded text-gray-400 hover:text-red-500 disabled:opacity-50"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        </div>

        {/* Pending user message (shown immediately while streaming) */}
        {pendingUserMessage && (
          <div className="flex gap-3 flex-row-reverse">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm">
              <span className="text-xs font-bold">U</span>
            </div>
            <div className="max-w-[80%] flex flex-col items-end">
              <div className="mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">你</span>
              </div>
              <div className="rounded-2xl rounded-tr-sm bg-gradient-to-br from-blue-500 to-blue-600 px-4 py-3 text-sm text-white shadow-sm">
                {pendingUserMessage}
              </div>
            </div>
          </div>
        )}

        {/* Streaming response - show during and after stream until messages refresh */}
        {(isStreaming || streamingContent || streamingThinking || streamingToolCalls.length > 0) && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Bot size={15} />
            </div>
            <div className="max-w-[80%] flex flex-col items-start">
              <div className="mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">AI 助手</span>
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3 dark:bg-gray-800">
                {/* Tool calls and results during streaming */}
                {streamingToolCalls.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {streamingToolCalls.map((tc, i) => {
                      const result = streamingToolResults.find(r => r.name === tc.name)
                      return (
                        <div key={tc.id || i} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800">
                          <div className="flex items-center gap-2">
                            <Loader2 size={12} className={result ? 'text-green-500' : 'text-blue-500 animate-spin'} />
                            <span className="font-medium text-gray-700 dark:text-gray-300">{tc.name}</span>
                          </div>
                          {result && !result.collapsed && (
                            <div className={`mt-1.5 rounded-md px-2.5 py-1.5 text-xs ${result.isError ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'}`}>
                              <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{result.content.length > 500 ? result.content.slice(0, 500) + '...' : result.content}</pre>
                            </div>
                          )}
                          {!result && (
                            <div className="mt-1 text-[11px] text-gray-400">执行中...</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
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
        {/* Todo progress panel - fixed above input */}
        {streamingTodos.length > 0 && (
          <div className="mb-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500">
              <ClipboardList size={14} /> 工作计划
            </div>
            <div className="space-y-1.5">
              {streamingTodos.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  {t.status === 'completed' ? (
                    <CircleCheckBig size={14} className="text-green-500" />
                  ) : t.status === 'in-progress' ? (
                    <Loader2 size={14} className="animate-spin text-blue-500" />
                  ) : (
                    <Circle size={14} className="text-gray-300" />
                  )}
                  <span className={
                    t.status === 'completed'
                      ? 'text-gray-400 line-through'
                      : t.status === 'in-progress'
                        ? 'font-medium text-blue-700 dark:text-blue-300'
                        : 'text-gray-600 dark:text-gray-400'
                  }>
                    {t.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ask question panel - sequential one-at-a-time mode */}
        {streamingQuestions.length > 0 && (() => {
          const total = streamingQuestions.length
          const idx = Math.min(currentQuestionIndex, total - 1)
          const q = streamingQuestions[idx]
          if (!q) return null
          const currentAnswer = questionAnswers[q.id]
          const hasAnswer = !!currentAnswer
          const answeredCount = streamingQuestions.filter(qq => questionAnswers[qq.id]).length
          const allAnswered = streamingQuestions.every(qq => questionAnswers[qq.id])
          const isFirst = idx === 0
          const isLast = idx === total - 1
          return (
            <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-900/20">
              {/* Header: step indicator + answered markers */}
              <div className="mb-3 flex items-center gap-2">
                <HelpCircle size={16} className="text-blue-500" />
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{q.header}</span>
                <span className="ml-auto text-[11px] text-gray-400">
                  {idx + 1} / {total}
                </span>
                {hasAnswer && (
                  <CircleCheckBig size={14} className="text-green-500" />
                )}
              </div>

              {/* Question text */}
              <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">{q.question}</p>

              {/* Options */}
              {q.options && q.options.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {q.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQuestionAnswers(prev => ({ ...prev, [q.id]: opt.label }))
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        currentAnswer === opt.label
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-blue-200 bg-white text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-blue-900/30'
                      }`}
                    >
                      {opt.label}
                      {opt.description && <span className="ml-1 text-gray-400">— {opt.description}</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* Custom input — do not reveal previous answer content when navigating back */}
              {q.allowCustom !== false && (
                <input
                  type="text"
                  placeholder={hasAnswer && q.options?.some(o => o.label === currentAnswer) ? '或输入自定义回答...' : '输入回答...'}
                  value={q.options?.some(o => o.label === currentAnswer) ? '' : (currentAnswer || '')}
                  onChange={(e) => {
                    setQuestionAnswers(prev => ({ ...prev, [q.id]: e.target.value }))
                  }}
                  className="w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-blue-700 dark:bg-gray-800"
                />
              )}

              {/* Navigation */}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentQuestionIndex(i => Math.max(0, i - 1))}
                    disabled={isFirst}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      isFirst
                        ? 'text-gray-300 cursor-not-allowed dark:text-gray-600'
                        : 'text-blue-600 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/30'
                    }`}
                  >
                    <ChevronLeft size={14} /> 上一题
                  </button>
                  {!isLast && (
                    <button
                      onClick={() => setCurrentQuestionIndex(i => Math.min(total - 1, i + 1))}
                      className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
                    >
                      下一题 <ChevronRight size={14} />
                    </button>
                  )}
                  {isLast && (
                    <button
                      onClick={submitAllAnswers}
                      disabled={!allAnswered}
                      className={`flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
                        allAnswered
                          ? 'bg-blue-500 text-white hover:bg-blue-600'
                          : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
                      }`}
                    >
                      提交
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-gray-400">
                  已回答 {answeredCount} / {total} 题
                </span>
              </div>
            </div>
          )
        })()}

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

              {/* Agent selector */}
              <div className="relative" ref={agentPickerRef}>
                <button
                  onClick={() => { setShowAgentPicker(!showAgentPicker); setShowModelPicker(false) }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    selectedPreset
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                  }`}
                  title="智能体"
                >
                  <Bot size={14} />
                  {selectedPreset ? selectedPreset.name : '智能体'}
                  <ChevronDown size={10} />
                </button>
                {showAgentPicker && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
                    <div className="max-h-56 overflow-y-auto p-1.5">
                      {presets.length === 0 ? (
                        <div className="p-3 text-center text-xs text-gray-500">暂无智能体</div>
                      ) : (
                        presets.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { applyPreset(p); setShowAgentPicker(false) }}
                            className={`w-full rounded-lg px-3 py-2 text-left ${selectedPreset?.id === p.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium ${selectedPreset?.id === p.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-800 dark:text-gray-200'}`}>{p.name}</span>
                              {selectedPreset?.id === p.id && <Check size={12} className="text-indigo-500" />}
                            </div>
                            <div className="mt-0.5 text-[10px] text-gray-400 truncate">{p.content.slice(0, 60)}</div>
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

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={isStreaming || (!input.trim() && attachedFiles.length === 0)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
            >
              <Send size={14} />
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-center text-[10px] text-gray-400">Shift + Enter 换行 · 支持粘贴文件</p>
      </div>
    </div>
  )
}