import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, FileText, Search, GitBranch, Check, X, Plus, Brain, Globe, Database, ChevronDown, ChevronRight, Loader2, Atom, Zap, AlertCircle, User, Eraser } from 'lucide-react'
import { chatMessageService, chatTopicService, promptPresetService } from '../services/chatService'
import { workProjectService } from '../services/workService'
import type { ChatMessageSearchResult } from '../services/chatService'
import { skillService } from '../services/skillService'
import { aiModelService } from '../services/aiProviderService'
import ThemedMarkdown from './ThemedMarkdown'
import ChatMessageItem from './ChatMessageItem'
import Select from './Select'

import AgentApprovalCard from './agent/AgentApprovalCard'
import AgentUsageBadge from './agent/AgentUsageBadge'
import AgentTimeline from './agent/AgentTimeline'
import AgentInputBox from './agent/AgentInputBox'
import AgentPermissionSelect from './agent/AgentPermissionSelect'
import AgentReasoningSelect from './agent/AgentReasoningSelect'
import AgentToolbarSelect from './agent/AgentToolbarSelect'
import AgentPicker from './agent/AgentPicker'
import { fromChatTimeline } from '../utils/agentTimeline'
import ToolInteractionDrawer from './ToolInteractionDrawer'
import InlineWorkflowPanel from './workflow/InlineWorkflowPanel'
import { type InputCommandItem } from './InputCommandMenu'
import { useStreaming } from '../hooks/useStreaming'
import { useNotebooks } from '../hooks/useNotebooks'
import { useMentionItems } from '../hooks/useMentionItems'
import { useWorkflowRun } from '../hooks/useWorkflowRun'
import { useChatStreamStore, chatStreamControl } from '../stores/chatStreamStore'
import { useConfirm } from './confirm'
import { loadTopicSettings, saveTopicSettings } from '../utils/topicSettings'
import { consumeSseStream, SSE_ERROR_PREFIX } from '../utils/sse'
import type { IChatTopic, IPromptPreset, INotebook, IChatGroup, ISkill } from '../types'

interface ChatMessageAreaProps {
  topic?: IChatTopic
  group?: IChatGroup
  onTopicUpdated?: (topic: IChatTopic) => void
  /** 页面当前打开的项目（Code 视图挂载的 Work 项目）：用于按需加载其 .github 智能体 / 技能 / 模板 */
  projectId?: string
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
  try {
    const response = await startRequest(controller.signal)
    await consumeSseStream(
      response,
      // 帧解析统一走 utils/agentStream：错误帧、交互事件、usage/文件/检查点等全事件集
      ({ data }) => store.handleFrame(topicId, data),
      { signal: controller.signal },
    )
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('Stream error:', error)
      store.setStreamError(topicId, '流式输出失败，请检查模型配置。')
    }
  } finally {
    chatStreamControl.unregister(topicId)
    store.stop(topicId)
    // 延迟清除流式状态，等消息列表刷新后再清理，避免闪烁
    setTimeout(() => store.clearAfterPersist(topicId), 500)
  }
}

export default function ChatMessageArea({ topic, group, onTopicUpdated, projectId }: ChatMessageAreaProps) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [input, setInput] = useState('')
  const topicId = topic?.id
  // 会话级配置：从缓存恢复（组件以 key=topic.id 重挂载，切会话自动换缓存）
  const cachedSettings = useMemo(() => loadTopicSettings(topicId), [topicId])
  const {
    streamingContent, setStreamingContent,
    streamingThinking,
    showThinking, setShowThinking,
    timeline,
    isStreaming, pendingUserMessage,
    streamingSearchResults,
    streamingKnowledgeResults,
    streamingMemoryResults,
    streamingToolResults,
    approvalRequests,
    usage,
    streamError, setStreamError,
    startStreaming, stopStreaming,
  } = useStreaming(topicId)

  // 两段输出之间的所有过程（工具调用、思考）折叠为一组，文本输出作为组分界
  // （折叠逻辑已内聚到 AgentTimeline，这里不再单独预折叠）

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
  const [deepThinking, setDeepThinking] = useState(() => cachedSettings.deepThinking ?? false)
  const [reasoningEffort, setReasoningEffort] = useState<string>(() => cachedSettings.reasoningEffort ?? 'medium')
  const [showReasoningPicker, setShowReasoningPicker] = useState(false)
  const [webSearch, setWebSearch] = useState(() => cachedSettings.webSearch ?? false)
  const [knowledgeBase, setKnowledgeBase] = useState(() => cachedSettings.knowledgeBase ?? false)
  const [toolCalling, setToolCalling] = useState(() => cachedSettings.toolCalling ?? true)
  const [permissionMode, setPermissionMode] = useState<string>(() => cachedSettings.permissionMode ?? 'ask')
  const [memory, setMemory] = useState(() => cachedSettings.memory ?? false)
  // 工作流运行（节点状态 / Human 审批 / Agent 工具交互）：与 Code 会话共用同一套逻辑
  const workflowRun = useWorkflowRun(setStreamingContent)
  const { workflow: runningWorkflow, nodes: workflowNodes, pendingApproval, toolCall: workflowToolCall, error: workflowError, workflows: availableWorkflows } = workflowRun
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState(() => cachedSettings.modelId ?? '')
  const [selectedSlashItem, setSelectedSlashItem] = useState<{ label: string; icon: React.ReactNode; type: 'skill' | 'agent'; description?: string } | null>(null)

  const [inputMenu, setInputMenu] = useState<{ kind: 'mention' | 'slash'; query: string } | null>(null)
  const [selectedMentions, setSelectedMentions] = useState<{ type: string; id: string; label: string }[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const thinkingEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  const notebooks = useNotebooks()

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

  // 页面已打开项目时：加载该项目 .github 下的智能体 / 提示词 / 技能（与 Code 会话同一份资产）
  const { data: copilotAssets } = useQuery({
    queryKey: ['workCopilotAssets', projectId],
    queryFn: () => (projectId ? workProjectService.getCopilotAssets(projectId) : Promise.resolve(null)),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  })
  // 选中的项目资产：正文作为系统提示，与智能体预设走同一条下发链路
  const [selectedProjectAsset, setSelectedProjectAsset] = useState<{ id: string; label: string; content: string } | null>(null)

  // 专业智能体的技能白名单：选了指定了技能的专业智能体后，/ 菜单与技能识别只保留其可用技能。
  // 存在无法映射到数据库技能的 ID（如本地技能）时放弃限制，避免误伤。
  const allowedSkillNames = useMemo(() => {
    const preset = selectedPreset
    if (!preset || preset.agentType !== 'Professional' || !preset.skillIds) return null
    let ids: unknown
    try { ids = JSON.parse(preset.skillIds) } catch { return null }
    if (!Array.isArray(ids) || ids.length === 0) return null
    const names = new Set<string>()
    for (const id of ids) {
      if (typeof id !== 'string') return null
      const skill = (skills as ISkill[]).find(s => s.id === id)
      if (!skill) return null
      names.add(skill.name)
    }
    return names
  }, [selectedPreset, skills])

  // @ 提及数据源：笔记 / 笔记本 / 标签 / 知识库（与 Code 会话共用同一份候选构建）
  const mentionQuery = inputMenu?.kind === 'mention' ? inputMenu.query : null
  const showMentionMenu = inputMenu?.kind === 'mention' && !isStreaming
  const mentionItems = useMentionItems(mentionQuery)

  const { data: aiModels = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  // Slash command menu items (db skills + local skills + agents)
  const slashItems = useMemo(() => {
    const items: { key: string; label: string; description: string; icon: React.ReactNode; type: 'skill' | 'agent' }[] = []
    const seenNames = new Set<string>()
    for (const s of skills as Array<{ name: string; description?: string; isEnabled: boolean }>) {
      if (s.isEnabled && !seenNames.has(s.name) && (!allowedSkillNames || allowedSkillNames.has(s.name))) {
        seenNames.add(s.name)
        items.push({ key: `skill:${s.name}`, label: `/${s.name}`, description: s.description || '', icon: <Zap size={14} className="text-violet-500" />, type: 'skill' })
      }
    }
    for (const s of localSkills as Array<{ name: string; description?: string; isEnabled: boolean }>) {
      if (s.isEnabled && !seenNames.has(s.name) && (!allowedSkillNames || allowedSkillNames.has(s.name))) {
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
    // 项目 .github 下的提示词模板与技能：正文随选中项作为系统提示下发
    for (const p of copilotAssets?.prompts ?? []) {
      if (!p.content) continue
      items.push({ key: `project-prompt:${p.name}`, label: `/${p.name}`, description: p.description || '项目提示词模板', icon: <Zap size={14} className="text-amber-500" />, type: 'skill' })
    }
    for (const s of copilotAssets?.skills ?? []) {
      if (!s.content) continue
      items.push({ key: `project-skill:${s.name}`, label: `/${s.name}`, description: s.description || '项目技能', icon: <Zap size={14} className="text-violet-500" />, type: 'skill' })
    }
    return items
  }, [skills, localSkills, presets, localPresets, allowedSkillNames, copilotAssets])

  // 浮层状态由 AgentInputBox 探测回传；这里只按查询词过滤候选项
  const slashQuery = inputMenu?.kind === 'slash' ? inputMenu.query.toLowerCase() : null
  const showSlashMenu = inputMenu?.kind === 'slash' && !selectedSlashItem && !isStreaming && slashItems.length > 0
  const filteredSlashItems = useMemo(() => {
    if (!showSlashMenu) return []
    if (!slashQuery) return slashItems
    return slashItems.filter(item =>
      item.label.toLowerCase().includes(slashQuery) || item.description.toLowerCase().includes(slashQuery)
    )
  }, [showSlashMenu, slashQuery, slashItems])

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
  }, [messages, pendingUserMessage, streamingContent, streamingThinking, isOrganizing, organizeResult, messagesLoading])

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
    if (s && !s.isStreaming && (s.streamingContent || s.streamingThinking || s.searchResults.length > 0 || s.knowledgeResults.length > 0 || s.memoryResults.length > 0 || s.toolResults.length > 0)) {
      useChatStreamStore.getState().clearAfterPersist(topicId)
    }
    // Intentionally only react to messages list changes (post-stream refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (showModelPicker && modelPickerRef.current && !modelPickerRef.current.contains(target)) {
        setShowModelPicker(false)
      }
      if (showReasoningPicker && reasoningPickerRef.current && !reasoningPickerRef.current.contains(target)) {
        setShowReasoningPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showModelPicker, showReasoningPicker])

  const chatModels = aiModels.filter((model) => model.purpose === 'chat' && model.providerId)
  // 缓存的模型可能已被删除，模型列表加载后回退到默认模型
  const activeModelId =
    chatModels.length === 0 || chatModels.some((m) => m.id === selectedModelId) ? selectedModelId : ''

  // Get current model's reasoning configuration
  const currentModel = activeModelId ? chatModels.find(m => m.id === activeModelId) : chatModels.find(m => m.isDefault) ?? chatModels[0]
  const currentReasoningMode = currentModel?.reasoningMode ?? 'none'
  const currentReasoningEffort = currentModel?.reasoningEffort ?? 'medium'

  // Sync reasoning effort from model when model changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReasoningEffort(currentReasoningEffort)
  }, [currentReasoningEffort])

  // 持久化会话级配置到 localStorage
  useEffect(() => {
    if (!topicId) return
    saveTopicSettings(topicId, {
      modelId: activeModelId || undefined,
      deepThinking,
      reasoningEffort,
      webSearch,
      knowledgeBase,
      memory,
      toolCalling,
      permissionMode,
    })
  }, [topicId, activeModelId, deepThinking, reasoningEffort, webSearch, knowledgeBase, memory, toolCalling, permissionMode])

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

  const applyPreset = (preset: IPromptPreset) => {
    setSelectedPreset(prev => prev?.id === preset.id ? null : preset)
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

  /** 选中一条 @ 提及：把输入框里的 @查询词 替换掉，并加入引用 chips */
  const applyMention = (item: InputCommandItem | undefined) => {
    if (!item) return
    const [type, id] = item.key.split(':')
    const at = input.lastIndexOf('@')
    if (at >= 0) {
      let end = at + 1
      while (end < input.length && !/\s/.test(input[end])) end++
      const next = (input.slice(0, at) + input.slice(end)).replace(/^\s+/, '').replace(/\s+$/, '')
      setInput(next)
    }
    setSelectedMentions(prev =>
      prev.some(m => m.type === type && m.id === id) ? prev : [...prev, { type, id, label: item.label }])
    setInputMenu(null)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  // 消费整理话题的 SSE 流，收集预览文本；返回是否未出现错误帧。
  const readSseStream = async (response: Response, onData: (data: string) => void): Promise<boolean> => {
    if (!response.body) return false
    let hasError = false
    await consumeSseStream(response, ({ data }) => {
      if (data.startsWith(SSE_ERROR_PREFIX)) hasError = true
      onData(data)
    })
    return !hasError
  }

  const handleSend = async () => {
    if (!topic || (!input.trim() && !selectedSlashItem && attachedFiles.length === 0 && selectedMentions.length === 0) || isStreaming) return

    const slashPrefix = selectedSlashItem ? selectedSlashItem.label + ' ' : ''
    const content = (slashPrefix + input.trim()).trim()
    const mentions = selectedMentions.map(m => ({ type: m.type, id: m.id }))
    setInput('')
    setSelectedSlashItem(null)
    setSelectedMentions([])
    setInputMenu(null)
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
      await workflowRun.run(content, topic.id, permissionMode)
      stopStreaming(topic.id)
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
      const skillAllowed = !allowedSkillNames || (!!skill && allowedSkillNames.has(skill.name)) || (!!localSkill && allowedSkillNames.has(localSkill.name))
      if ((skill || localSkill) && skillAllowed) detectedSkillName = name
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
        modelId: activeModelId || undefined,
        deepThinking,
        reasoningEffort: deepThinking ? reasoningEffort : undefined,
        webSearch, knowledgeBase, memory,
        presetSystemPrompt: detectedPresetContent || selectedProjectAsset?.content || selectedPreset?.content || undefined,
        images: images.length > 0 ? images : undefined,
        skillName: detectedSkillName,
        agentId: detectedAgentId || selectedPreset?.id,
        enableTools: toolCalling,
        // 始终下发全局审批模式：auto 也必须显式覆盖，否则各工具 DefaultApproval（如 run_command=Ask）仍会逐个询问
        permissionMode,
        mentions: mentions.length > 0 ? mentions : undefined,
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

  // 主对话全局唯一：清空旧消息，避免累积上下文污染后续对话
  const clearTopicMutation = useMutation({
    mutationFn: (topicId: string) => chatTopicService.clear(topicId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatMessages', topic?.id] })
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
    },
  })

  const handleClearTopic = useCallback(() => {
    if (!topic) return
    confirm({
      message: '确定清空主对话的所有消息吗？清空后不可恢复，后续对话将从头开始。',
      onConfirm: () => clearTopicMutation.mutate(topic.id),
    })
  }, [confirm, topic, clearTopicMutation])

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
      await chatMessageService.submitApproval(topic?.id, toolCallId, approved)
    } catch {
      // Ignore — backend will timeout anyway
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
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
            <span className={`h-2 w-2 shrink-0 rounded-full ${isStreaming ? 'animate-pulse bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            {topic.title}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{group ? `${group.name} · ` : ''}{messages.length} 条消息</p>
        </div>
        <div className="flex items-center gap-1">
          {topic.isMain && (
            <button
              onClick={handleClearTopic}
              disabled={isStreaming || clearTopicMutation.isPending}
              className="p-2 text-gray-400 hover:bg-gray-100 hover:text-red-500 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-gray-800 dark:hover:text-red-400"
              title="清空主对话"
            >
              {clearTopicMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Eraser size={15} />}
            </button>
          )}
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
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              isEditing={editingMessageId === message.id}
              editingContent={editingMessageId === message.id ? editingContent : ''}
              isCopied={copiedMessageId === message.id}
              actionsDisabled={isStreaming || updateMessageMutation.isPending || deleteMessageMutation.isPending}
              onCopy={copyMessage}
              onStartEdit={startEditingMessage}
              onSaveEdit={saveEditingMessage}
              onCancelEdit={cancelEditingMessage}
              onDelete={deleteMessage}
              onEditContentChange={setEditingContent}
            />
          ))}
        {/* Pending user message (shown until the message sent at/after stream start is persisted) */}
        {/* 与流式回复同在 space-y-5 容器内：否则流式期间回复会贴着用户气泡（完成后进入容器才恢复间距） */}
        {pendingUserMessage && !messages.some((m) => m.role === 'user' && new Date(m.createdAt).getTime() >= streamStartedAt - 2000) && (
          <div className="flex flex-row-reverse gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm">
              <User size={13} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-end">
              <div className="mb-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">你</span>
              </div>
              <div className="w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-50/70 px-4 py-2.5 text-sm text-gray-900 dark:bg-blue-950/30 dark:text-gray-100">
                {pendingUserMessage}
              </div>
            </div>
          </div>
        )}

        {/* Streaming response - show during and after stream until messages refresh */}
        {(isStreaming || streamingContent || streamingThinking || timeline.length > 0 || streamingSearchResults.length > 0 || streamingKnowledgeResults.length > 0 || streamingMemoryResults.length > 0 || streamingToolResults.length > 0) && (
          <div className="flex flex-col">
              {/* 瀑布流：按时间线顺序穿插渲染 思考 → 工具调用 → 文本，与编码会话/任务看板共用 AgentTimeline */}
              <div className="text-gray-800 dark:text-gray-100">
                <AgentTimeline
                  items={fromChatTimeline(timeline)}
                  streaming={isStreaming}
                  onApprove={handleApprove}
                />
                {timeline.length > 0 && <div ref={thinkingEndRef} />}
                {/* 时间线为空但仍有思考内容的降级渲染 */}
                {timeline.length === 0 && streamingThinking && (
                  <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
                    <button
                      onClick={() => setShowThinking(!showThinking)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100/60 dark:text-gray-400 dark:hover:bg-gray-800/60"
                    >
                      {showThinking ? <ChevronDown size={11} className="shrink-0 text-gray-400" /> : <ChevronRight size={11} className="shrink-0 text-gray-400" />}
                      <Brain size={11} className="shrink-0 text-gray-400" />
                      <span>深度思考</span>
                    </button>
                    {showThinking && (
                      <div className="max-h-48 overflow-y-auto border-t border-gray-100 bg-white px-2.5 py-2 dark:border-gray-800 dark:bg-gray-900">
                        <ThemedMarkdown source={streamingThinking} />
                        <div ref={thinkingEndRef} />
                      </div>
                    )}
                  </div>
                )}
                {/* Search results citations - show when web search was used */}
                {(streamWebSearch || streamingSearchResults.length > 0) && streamingSearchResults.length > 0 && (
                  <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <div className="flex items-center gap-1 border-b border-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-400 dark:border-gray-800">
                      <Search size={11} />
                      参考来源
                    </div>
                    <div className="space-y-0.5 p-1.5">
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
                  <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <div className="flex items-center gap-1 border-b border-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-400 dark:border-gray-800">
                      <Atom size={11} />
                      记忆参考
                    </div>
                    <div className="space-y-0.5 p-1.5">
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
                {/* Loading dots - show only when streaming and nothing rendered yet */}
                {timeline.length === 0 && !streamingContent && !streamingThinking && isStreaming && (
                  <div className="flex items-center gap-1.5 py-1">
                    <Loader2 size={12} className="animate-spin text-gray-400" />
                    <span className="text-[11px] text-gray-400">思考中...</span>
                  </div>
                )}
              </div>
          </div>
        )}
        </div>

        {streamError && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{streamError}</span>
            <button onClick={() => setStreamError('')} className="ml-auto shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"><X size={14} /></button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-100 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        {selectedProjectAsset && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-900/20">
            <Bot size={14} className="text-indigo-500" />
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              项目智能体：{selectedProjectAsset.label}
            </span>
            <button onClick={() => setSelectedProjectAsset(null)} className="ml-auto text-indigo-400 hover:text-indigo-600"><X size={14} /></button>
          </div>
        )}
        {selectedPreset && (
          <div className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${
            selectedPreset.agentType === 'Professional'
              ? 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-900/20'
              : 'border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-900/20'
          }`}>
            {selectedPreset.agentType === 'Professional'
              ? <Brain size={14} className="text-violet-500" />
              : <Bot size={14} className="text-indigo-500" />}
            <span className={`text-xs font-medium ${
              selectedPreset.agentType === 'Professional'
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-indigo-600 dark:text-indigo-400'
            }`}>
              智能体：{selectedPreset.name}
            </span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              selectedPreset.agentType === 'Professional'
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
            }`}>
              {selectedPreset.agentType === 'Professional' ? '专业' : '通用'}
            </span>
            {allowedSkillNames && (
              <span className="text-[10px] text-gray-400">仅可用 {allowedSkillNames.size} 个技能</span>
            )}
            <button onClick={() => setSelectedPreset(null)} className="ml-auto text-indigo-400 hover:text-indigo-600"><X size={14} /></button>          </div>
        )}
        {runningWorkflow && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
            <GitBranch size={14} className="text-blue-500" />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">工作流：{runningWorkflow.name}</span>
            <button onClick={() => workflowRun.setWorkflow(null)} className="ml-auto text-blue-400 hover:text-blue-600"><X size={14} /></button>
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
              onApprove={workflowRun.approve}
              onToolApprove={workflowRun.submitToolInteraction}
              isStreaming={isStreaming}
              error={workflowError}
            />
          </div>
        )}
        {/* 工具审批卡片：与编码会话共用同一组件 */}
        {approvalRequests.map((req) => (
          <div key={req.id} className="mb-2">
            <AgentApprovalCard
              request={req}
              onApprove={() => handleApprove(req.id, true)}
              onDeny={() => handleApprove(req.id, false)}
            />
          </div>
        ))}

        {/* 本次流的累计用量：与编码会话顶栏共用同一徽标 */}
        {isStreaming && <div className="mb-2 flex justify-end"><AgentUsageBadge usage={usage} compact /></div>}

        {/* 工具交互抽屉：ask_question / todo / plan 触发时在输入框上方滑出（对话页与编码页共用） */}
        <ToolInteractionDrawer streamKey={topicId ?? ''} streaming={isStreaming} />

        {/* 工具审批卡片：与编码会话共用同一组件 */}
        {approvalRequests.map((req) => (
          <div key={req.id} className="mb-2">
            <AgentApprovalCard
              request={req}
              onApprove={() => handleApprove(req.id, true)}
              onDeny={() => handleApprove(req.id, false)}
            />
          </div>
        ))}

        {/* 本次流的累计用量：与编码会话顶栏共用同一徽标 */}
        {isStreaming && <div className="mb-2 flex justify-end"><AgentUsageBadge usage={usage} compact /></div>}

        {/* 工具交互抽屉：ask_question / todo / plan 触发时在输入框上方滑出（对话页与编码页共用） */}
        <ToolInteractionDrawer streamKey={topicId ?? ''} streaming={isStreaming} />

        {/* 输入区：与编码会话共用 AgentInputBox（浮层 / chips / 历史回溯 / 发送-停止），工具栏为对话页独有 */}
        <AgentInputBox
          value={input}
          onChange={(v) => setInput(v)}
          onMenuChange={setInputMenu}
          onSubmit={handleSend}
          onPaste={handlePaste}
          textareaRef={textareaRef}
          menu={showSlashMenu
            ? (filteredSlashItems.length > 0
                ? {
                    kind: 'slash' as const,
                    items: filteredSlashItems,
                    onSelect: (item: InputCommandItem) => {
                      setSelectedSlashItem({
                        label: item.label,
                        icon: item.icon,
                        type: (item.type ?? 'skill') as 'skill' | 'agent',
                        description: item.description,
                      })
                      // 项目 .github 的模板/技能：正文随本轮下发，作为系统提示
                      if (item.key.startsWith('project-prompt:') || item.key.startsWith('project-skill:')) {
                        const name = item.key.slice(item.key.indexOf(':') + 1)
                        const asset = item.key.startsWith('project-prompt:')
                          ? copilotAssets?.prompts.find((p) => p.name === name)
                          : copilotAssets?.skills.find((s) => s.name === name)
                        setSelectedProjectAsset(asset?.content
                          ? { id: item.key, label: item.label, content: asset.content }
                          : null)
                      } else {
                        setSelectedProjectAsset(null)
                      }
                      setInput('')
                    },
                    emptyHint: '没有匹配的技能或智能体',
                  }
                : null)
            : (showMentionMenu && mentionItems.length > 0
                ? {
                    kind: 'mention' as const,
                    items: mentionItems,
                    onSelect: applyMention,
                    emptyHint: mentionQuery?.trim() ? '没有匹配的引用' : '输入关键词搜索...',
                  }
                : null)}
          chips={[
            ...attachedFiles.map((file, i) => ({
              id: `file:${i}`,
              label: file.name,
              icon: <FileText size={12} className="text-blue-500" />,
              onRemove: () => removeAttachedFile(i),
            })),
            ...selectedMentions.map((m) => ({
              id: `${m.type}:${m.id}`,
              label: m.label,
              tone: 'blue' as const,
              onRemove: () => setSelectedMentions((prev) => prev.filter((x) => !(x.type === m.type && x.id === m.id))),
            })),
            ...(selectedSlashItem
              ? [{
                  id: `slash:${selectedSlashItem.label}`,
                  label: selectedSlashItem.label,
                  tone: 'violet' as const,
                  title: selectedSlashItem.description,
                  onRemove: () => setSelectedSlashItem(null),
                }]
              : []),
          ]}
          placeholder={
            selectedSlashItem
              ? (selectedSlashItem.description || '输入内容...')
              : attachedFiles.length > 0
                ? `已附加 ${attachedFiles.length} 张图片，输入消息...`
                : '输入消息，Enter 发送，/ 选技能，@ 引用笔记...'
          }
          streaming={isStreaming}
          onStop={handleStop}
          canSubmit={!!input.trim() || attachedFiles.length > 0 || !!selectedSlashItem || selectedMentions.length > 0}
          hint="Shift + Enter 换行 · 支持粘贴文件"
          toolbar={
            <>
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

              {/* Agent selector — 智能体 + 工作流合并（与 Code 会话共用同一浮层组件） */}
              <AgentPicker
                items={[
                  ...presets.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.content.slice(0, 120),
                    icon: p.agentType === 'Professional' ? 'brain' as const : 'bot' as const,
                    badge: p.agentType === 'Professional' ? '专业' : undefined,
                  })),
                  ...localPresets.map(p => ({ id: p.id, name: p.name, description: p.content.slice(0, 120), icon: 'bot' as const, badge: '本地' })),
                ]}
                value={selectedPreset?.id}
                onSelect={(item) => {
                  // 项目 .github 智能体：正文作为本轮系统提示下发（与 Code 会话同一份资产）
                  const projectAgent = copilotAssets?.agents.find(a => a.id === item.id)
                  if (projectAgent) {
                    setSelectedProjectAsset({ id: item.id, label: projectAgent.name, content: projectAgent.content })
                    setSelectedPreset(null)
                    workflowRun.setWorkflow(null)
                    return
                  }
                  setSelectedProjectAsset(null)
                  const preset = presets.find(p => p.id === item.id)
                  workflowRun.setWorkflow(null)
                  if (preset) {
                    applyPreset(preset)
                    return
                  }
                  const local = localPresets.find(p => p.id === item.id)
                  if (local) {
                    applyPreset({
                      id: local.id,
                      category: local.category || '本地',
                      name: local.name,
                      content: local.content,
                      variables: local.variables,
                      toolsConfig: local.toolsConfig,
                      isBuiltIn: false,
                      agentType: 'General',
                      sortOrder: 0,
                      createdAt: '',
                      updatedAt: '',
                    })
                  }
                }}
                projectItems={(copilotAssets?.agents ?? []).map(a => ({ id: a.id, name: a.name, description: a.description, icon: 'bot' as const }))}
                projectValue={selectedProjectAsset && copilotAssets?.agents.some(a => a.id === selectedProjectAsset.id) ? selectedProjectAsset.id : undefined}
                onSelectProject={(item) => {
                  const agent = copilotAssets?.agents.find(a => a.id === item.id)
                  if (!agent) return
                  setSelectedProjectAsset({ id: item.id, label: agent.name, content: agent.content })
                  setSelectedPreset(null)
                  workflowRun.setWorkflow(null)
                }}
                workflows={availableWorkflows.map(w => ({ id: w.id, name: w.name, description: w.description, icon: 'git' as const }))}
                workflowValue={runningWorkflow?.id}
                onSelectWorkflow={(item) => {
                  const workflow = availableWorkflows.find(w => w.id === item.id)
                  if (workflow) { setSelectedPreset(null); workflowRun.setWorkflow(workflow) }
                }}
              />

              {/* 模型选择：与编码会话共用同一组件 */}
              <AgentToolbarSelect
                value={activeModelId}
                onChange={setSelectedModelId}
                title="选择模型"
                options={[{ value: '', label: '默认模型' }, ...chatModels.map((m) => ({ value: m.id, label: m.displayName }))]}
                />
                <div className="flex items-center gap-1">
                {toolCalling && <AgentPermissionSelect value={permissionMode} onChange={setPermissionMode} />}
                <button
                  onClick={() => setToolCalling(!toolCalling)}
                  className={`flex h-[26px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors ${
                    toolCalling
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
                  }`}
                  title="工具调用"
                >
                  <Zap size={13} />
                  工具
                </button>
              </div>

              <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />

              {/* 推理强度 / 深度思考：与编码会话共用同一组件 */}
              <AgentReasoningSelect
                value={reasoningEffort}
                onChange={setReasoningEffort}
                reasoningMode={currentReasoningMode}
                enabled={deepThinking}
                onEnabledChange={setDeepThinking}
              />

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
              </button>
            </>
          }
        />
      </div>
    </div>
  )
}






