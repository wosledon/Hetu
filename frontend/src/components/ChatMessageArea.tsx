import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, FileText, Sparkles, Search, GitBranch, Settings, Copy, Check, Pencil, Trash2, X, Save, RotateCcw, Plus, Brain, Globe, Database, ChevronDown, Loader2 } from 'lucide-react'
import { chatMessageService, chatTopicService, promptPresetService } from '../services/chatService'
import type { ChatMessageSearchResult } from '../services/chatService'
import { notebookService } from '../services/notebookService'
import { skillService } from '../services/skillService'
import { aiModelService } from '../services/aiProviderService'
import ThemedMarkdown from './ThemedMarkdown'
import type { IChatTopic, IPromptPreset } from '../types'

interface ChatMessageAreaProps {
  topic?: IChatTopic
  group?: IChatGroup
  onTopicUpdated?: (topic: IChatTopic) => void
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
  const [streamingKnowledgeResults, setStreamingKnowledgeResults] = useState<Array<{ title: string; contentSnippet: string; id: string }>>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isOrganizing, setIsOrganizing] = useState(false)
  const [organizePreview, setOrganizePreview] = useState('')
  const [organizeStyle, setOrganizeStyle] = useState<'summary' | 'detailed' | 'qna'>('summary')
  const [organizeTargetNotebook, setOrganizeTargetNotebook] = useState('')
  const [organizeResult, setOrganizeResult] = useState<{ noteId: string; title: string } | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<IPromptPreset | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChatMessageSearchResult[]>([])
  const [showAutoOrganizeSettings, setShowAutoOrganizeSettings] = useState(false)
  const [showTopicSettings, setShowTopicSettings] = useState(false)
  const [topicModelId, setTopicModelId] = useState('')
  const [topicSystemPrompt, setTopicSystemPrompt] = useState('')
  const [topicContextWindowSize, setTopicContextWindowSize] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [deepThinking, setDeepThinking] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [knowledgeBase, setKnowledgeBase] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const agentPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)

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

  const { data: presets = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
  })

  const { data: aiModels = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, streamingThinking, organizePreview])

  // Clear streaming display when messages are refreshed (after query invalidation)
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
    setTopicContextWindowSize(topic?.contextWindowSize?.toString() ?? '')
  }, [topic?.id, topic?.modelId, topic?.customSystemPrompt, topic?.contextWindowSize])
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
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAgentPicker, showModelPicker])

  const chatModels = aiModels.filter((model) => model.purpose === 'chat' && model.providerId)

  // Get current model's reasoning configuration
  const currentModel = selectedModelId ? chatModels.find(m => m.id === selectedModelId) : chatModels.find(m => m.isDefault) ?? chatModels[0]
  const currentReasoningMode = currentModel?.reasoningMode ?? 'none'
  const currentReasoningEffort = currentModel?.reasoningEffort ?? 'medium'

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
    if (!topic || (!input.trim() && attachedFiles.length === 0) || isStreaming) return

    const content = input.trim()
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')
    setStreamingThinking('')
    setStreamingSearchResults([])
    setPendingUserMessage(content)
    setStreamDeepThinking(deepThinking)
    setStreamWebSearch(webSearch)
    setStreamKnowledgeBase(knowledgeBase)
    setStreamingKnowledgeResults([])

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

    const skillMatch = content.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/)
    if (skillMatch) {
      const skillName = skillMatch[1]
      const skillInput = skillMatch[2] || ''
      const skill = skills.find((s) => s.name === skillName && s.isEnabled)

      if (skill) {
        try {
          await chatMessageService.send(topic.id, { content })
          const result = await skillService.invoke(skillName, { input: skillInput })
          await chatMessageService.send(topic.id, { content: result })
          queryClient.invalidateQueries({ queryKey: ['chatMessages', topic.id] })
        } catch (error) {
          console.error('Skill error:', error)
          setStreamingContent('Skill 调用失败，请检查模型配置。')
          setTimeout(() => setStreamingContent(''), 3000)
        } finally {
          setIsStreaming(false)
          setPendingUserMessage(null)
        }
        return
      }
    }

    try {
      const response = await chatMessageService.stream(topic.id, {
        content,
        deepThinking,
        webSearch,
        knowledgeBase,
        images: images.length > 0 ? images : undefined,
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
      const contextWindowSize = Number.parseInt(topicContextWindowSize, 10)
      return chatTopicService.update(topic!.id, {
        title: topic!.title,
        modelId: topicModelId || undefined,
        customSystemPrompt: topicSystemPrompt.trim() || undefined,
        contextWindowSize: Number.isFinite(contextWindowSize) && contextWindowSize > 0 ? contextWindowSize : undefined,
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
        } else if (data.startsWith('[ERROR]')) {
          setOrganizePreview((prev) => prev + '\n' + data)
        } else {
          preview += data
          setOrganizePreview(preview)
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
            onClick={handleOrganize}
            disabled={isOrganizing || isStreaming || messages.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed dark:text-emerald-400 dark:hover:bg-emerald-900/20"
          >
            <FileText size={14} />
            {isOrganizing ? '整理中...' : '整理笔记'}
          </button>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" />
          <button
            onClick={() => setShowTopicSettings(!showTopicSettings)}
            className={`p-2 rounded-lg transition-colors ${showTopicSettings ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'}`}
            title="话题设置"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {showTopicSettings && topic && (
        <div className="border-b border-gray-200 bg-gray-50/80 p-5 dark:border-gray-800 dark:bg-gray-900/50">
          <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-200">话题设置</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1.5 block text-gray-600 dark:text-gray-400">对话模型</span>
              <select
                value={topicModelId}
                onChange={(e) => setTopicModelId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">使用默认对话模型</option>
                {chatModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName || model.modelId}{model.isDefault ? '（默认）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block text-gray-600 dark:text-gray-400">上下文窗口消息数</span>
              <input
                type="number"
                min="1"
                value={topicContextWindowSize}
                onChange={(e) => setTopicContextWindowSize(e.target.value)}
                placeholder="使用系统默认"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </div>
          <label className="mt-4 block text-sm">
            <span className="mb-1.5 block text-gray-600 dark:text-gray-400">系统提示词</span>
            <textarea
              value={topicSystemPrompt}
              onChange={(e) => setTopicSystemPrompt(e.target.value)}
              placeholder="留空则不设置话题级系统提示词"
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              rows={3}
            />
          </label>
          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
            <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">整理为笔记</h4>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-xs text-gray-600 dark:text-gray-400">整理风格</span>
                <select
                  value={organizeStyle}
                  onChange={(e) => setOrganizeStyle(e.target.value as typeof organizeStyle)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                >
                  <option value="summary">摘要式</option>
                  <option value="detailed">详细式</option>
                  <option value="qna">Q&A 式</option>
                </select>
              </div>
              <div>
                <span className="mb-1.5 block text-xs text-gray-600 dark:text-gray-400">目标笔记本</span>
                <select
                  value={organizeTargetNotebook}
                  onChange={(e) => setOrganizeTargetNotebook(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                >
                  <option value="">默认笔记本</option>
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setShowTopicSettings(false)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              关闭
            </button>
            <button
              onClick={() => updateTopicSettingsMutation.mutate()}
              disabled={updateTopicSettingsMutation.isPending}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {updateTopicSettingsMutation.isPending ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      )}

      {showAutoOrganizeSettings && topic && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
          <h3 className="text-sm font-medium mb-3">自动整理设置</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">启用自动整理</span>
              <button
                onClick={() => {
                  const newValue = !topic.isAutoOrganizeEnabled
                  updateAutoOrganizeMutation.mutate({
                    enabled: newValue,
                    notebookId: topic.autoOrganizeNotebookId,
                  })
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  topic.isAutoOrganizeEnabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    topic.isAutoOrganizeEnabled ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {topic.isAutoOrganizeEnabled && (
              <div>
                <label className="block text-sm mb-1">目标笔记本</label>
                <select
                  value={topic.autoOrganizeNotebookId || ''}
                  onChange={(e) => {
                    updateAutoOrganizeMutation.mutate({
                      enabled: true,
                      notebookId: e.target.value || undefined,
                    })
                  }}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800"
                >
                  <option value="">默认笔记本</option>
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  当对话消息达到 20 条时，系统将自动整理为笔记
                </p>
              </div>
            )}
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
          <div className="flex justify-end">
            <div className="max-w-[80%] flex flex-col items-end">
              <div className="rounded-2xl rounded-tr-sm bg-blue-500 px-4 py-3 text-sm text-white">
                {pendingUserMessage}
              </div>
            </div>
          </div>
        )}

        {/* Streaming response - show during and after stream until messages refresh */}
        {(isStreaming || streamingContent || streamingThinking) && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Bot size={15} />
            </div>
            <div className="max-w-[80%] flex flex-col items-start">
              <div className="mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">AI 助手</span>
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

        {isOrganizing && (
          <div className="border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 bg-emerald-50 dark:bg-emerald-900/20">
            <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300 mb-2">整理预览</div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ThemedMarkdown source={organizePreview || '整理中...'} />
            </div>
          </div>
        )}

        {organizeResult && !isOrganizing && (
          <div className="border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 bg-emerald-50 dark:bg-emerald-900/20">
            <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300 mb-1">
              已保存笔记：{organizeResult.title}
            </div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400">ID: {organizeResult.noteId}</div>
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
        <div className="rounded-xl border border-gray-200 bg-white transition-colors focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:focus-within:border-blue-500">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            onPaste={handlePaste}
            placeholder={attachedFiles.length > 0 ? `已附加 ${attachedFiles.length} 张图片，输入消息...` : "输入消息，Enter 发送..."}
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
                <div className="relative">
                  <button
                    onClick={() => setDeepThinking(!deepThinking)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      deepThinking
                        ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                        : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                    }`}
                    title="推理强度"
                  >
                    <Brain size={14} />
                    {currentReasoningEffort === 'low' ? '低' : currentReasoningEffort === 'high' ? '高' : currentReasoningEffort === 'off' ? '关闭' : '中'}
                    <ChevronDown size={10} />
                  </button>
                  {deepThinking && (
                    <div className="absolute bottom-full left-0 mb-2 w-32 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
                      <div className="p-1.5">
                        {['low', 'medium', 'high'].map(level => (
                          <button
                            key={level}
                            onClick={() => { setDeepThinking(true) }}
                            className={`w-full rounded-lg px-3 py-1.5 text-left text-xs ${currentReasoningEffort === level ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          >
                            {level === 'low' ? '低强度' : level === 'medium' ? '中等' : '高强度'}
                          </button>
                        ))}
                        <button
                          onClick={() => setDeepThinking(false)}
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