import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, FileText, Sparkles, Search, GitBranch, Settings, Copy, Check, Pencil, Trash2, X, Save, RotateCcw } from 'lucide-react'
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
  const [isStreaming, setIsStreaming] = useState(false)
  const [isOrganizing, setIsOrganizing] = useState(false)
  const [organizePreview, setOrganizePreview] = useState('')
  const [organizeStyle, setOrganizeStyle] = useState<'summary' | 'detailed' | 'qna'>('summary')
  const [organizeTargetNotebook, setOrganizeTargetNotebook] = useState('')
  const [organizeResult, setOrganizeResult] = useState<{ noteId: string; title: string } | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<IPromptPreset | null>(null)
  const [presetVars, setPresetVars] = useState<Record<string, string>>({})
  const [showPresetPicker, setShowPresetPicker] = useState(false)
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
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
  }, [messages, streamingContent, organizePreview])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setTopicModelId(topic?.modelId ?? '')
    setTopicSystemPrompt(topic?.customSystemPrompt ?? '')
    setTopicContextWindowSize(topic?.contextWindowSize?.toString() ?? '')
  }, [topic?.id, topic?.modelId, topic?.customSystemPrompt, topic?.contextWindowSize])
  /* eslint-enable react-hooks/set-state-in-effect */

  const chatModels = aiModels.filter((model) => model.purpose === 'chat' && model.providerId)

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
    setSelectedPreset(preset)
    setShowPresetPicker(false)
    const varNames: string[] = preset.variables
      ? (() => { try { return JSON.parse(preset.variables) } catch { return [] } })()
      : []
    const vars: Record<string, string> = {}
    varNames.forEach(v => { vars[v] = '' })
    setPresetVars(vars)
    if (varNames.length === 0) {
      setInput(preset.content)
      setSelectedPreset(null)
    }
  }

  const resolvePreset = () => {
    if (!selectedPreset) return
    let resolved = selectedPreset.content
    Object.entries(presetVars).forEach(([key, value]) => {
      resolved = resolved.replaceAll(`{{${key}}}`, value)
    })
    setInput(resolved)
    setSelectedPreset(null)
    setPresetVars({})
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
    if (!topic || !input.trim() || isStreaming) return

    const content = input.trim()
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

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
        }
        return
      }
    }

    try {
      const response = await chatMessageService.stream(topic.id, { content })
      await readSseStream(response, (data) => {
        if (data.startsWith('[ERROR]')) {
          setStreamingContent((prev) => prev + '\n' + data)
        } else {
          setStreamingContent((prev) => prev + data)
        }
      })
      queryClient.invalidateQueries({ queryKey: ['chatMessages', topic.id] })
    } catch (error) {
      console.error('Stream error:', error)
      setStreamingContent('流式输出失败，请检查模型配置。')
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
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
        isArchived: topic!.isArchived,
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
        isArchived: topic!.isArchived,
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
                {message.modelId && message.role === 'assistant' && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{message.modelId}</span>
                )}
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
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ThemedMarkdown source={message.content} />
                  </div>
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

        {isStreaming && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Bot size={15} />
            </div>
            <div className="max-w-[80%] flex flex-col items-start">
              <div className="mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">AI 助手</span>
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3 dark:bg-gray-800">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ThemedMarkdown source={streamingContent || ''} />
                </div>
                {!streamingContent && (
                  <div className="flex items-center gap-1 py-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]"></span>
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]"></span>
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]"></span>
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
            <Sparkles size={14} className="text-indigo-500" />
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{selectedPreset.name}</span>
            {Object.keys(presetVars).length > 0 && (
              <div className="flex flex-wrap gap-2 ml-auto">
                {Object.entries(presetVars).map(([key, value]) => (
                  <input
                    key={key}
                    type="text"
                    value={value}
                    onChange={(e) => setPresetVars(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={key}
                    className="w-28 rounded border border-indigo-300 bg-white px-2 py-0.5 text-xs outline-none focus:border-indigo-500 dark:border-indigo-700 dark:bg-indigo-900/40"
                  />
                ))}
                <button onClick={resolvePreset} className="rounded bg-indigo-600 px-2 py-0.5 text-xs text-white">应用</button>
                <button onClick={() => { setSelectedPreset(null); setPresetVars({}) }} className="text-xs text-gray-500 hover:text-gray-700">取消</button>
              </div>
            )}
          </div>
        )}
        <div className="flex items-end gap-3">
          <div className="relative">
            <button
              onClick={() => setShowPresetPicker(!showPresetPicker)}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-indigo-500 transition-colors dark:hover:bg-gray-800"
              title="使用预设"
            >
              <Sparkles size={18} />
            </button>
            {showPresetPicker && (
              <div className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
                <div className="max-h-56 overflow-y-auto p-1.5">
                  {presets.length === 0 ? (
                    <div className="p-3 text-center text-xs text-gray-500">暂无预设</div>
                  ) : (
                    presets.map(p => (
                      <button
                        key={p.id}
                        onClick={() => applyPreset(p)}
                        className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.name}</div>
                        <div className="mt-0.5 text-xs text-gray-500 truncate">{p.content}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="输入消息，Enter 发送..."
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 pr-12 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-blue-500 dark:focus:bg-gray-800"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-gray-400">Shift + Enter 换行</p>
      </div>
    </div>
  )
}
