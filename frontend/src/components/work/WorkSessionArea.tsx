import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, Loader2,

  ListChecks, Coins, User, Copy, Check, X, Braces, FolderOpen, SquareTerminal, Bot, GitBranch, Plus,
  Download, Stethoscope, RotateCcw, FileCode, PanelRightClose, PanelRightOpen, Zap,
  Globe, Database, Atom, Pencil, Trash2, Gauge,
} from 'lucide-react'
import { workSessionService, workProjectService, workOpenService, workCheckpointService, workFileService } from '../../services/workService'
import { aiModelService, aiProviderService } from '../../services/aiProviderService'
import { promptPresetService } from '../../services/promptPresetService'
import { skillService } from '../../services/skillService'
import { type InputCommandItem } from '../InputCommandMenu'
import type { IWorkSession, IWorkMessage, IWorkProject, WorkPermissionMode, IWorkOpenApp, IWorkCopilotAgent } from '../../types/work'
import ThemedMarkdown from '../ThemedMarkdown'
import ToolCallGroup from '../ToolCallGroup'
import { foldConsecutiveToolCalls, type ToolCallEntry } from '../../utils/toolRendering'
import { consumeSseStream, SSE_ERROR_PREFIX } from '../../utils/sse'
import { formatTokens, parseAgentFrame, type AgentUsage } from '../../utils/agentStream'
import ChatToolCallRow from '../ChatToolCallRow'

import AgentUsageBadge from '../agent/AgentUsageBadge'
import AgentTimeline from '../agent/AgentTimeline'
import AgentThoughtBlock from '../agent/AgentThoughtBlock'
import AgentFileChangeRow from '../agent/AgentFileChangeRow'
import AgentCheckpointRow from '../agent/AgentCheckpointRow'
import AgentSubAgentRow from '../agent/AgentSubAgentRow'
import AgentInputBox from '../agent/AgentInputBox'
import AgentModelPicker from '../agent/AgentModelPicker'
import AgentPicker from '../agent/AgentPicker'
import AgentPermissionSelect from '../agent/AgentPermissionSelect'
import AgentModeSelect from '../agent/AgentModeSelect'
import AgentContextUsage from '../agent/AgentContextUsage'
import { parseAgentMode, type AgentRunMode } from '../../utils/agentMode'
import type { IContextUsage } from '../../types/context'
import AgentReasoningSelect from '../agent/AgentReasoningSelect'
import { parsePermissionMode } from '../../utils/agentPermission'
import { fromWorkStreamItems } from '../../utils/agentTimeline'
import { reasoningEffortDefault } from '../../utils/agentReasoning'
import { loadTopicSettings, saveTopicSettings } from '../../utils/topicSettings'
import { useMentionItems } from '../../hooks/useMentionItems'
import { useWorkflowRun } from '../../hooks/useWorkflowRun'
import InlineWorkflowPanel from '../workflow/InlineWorkflowPanel'
import { useConfirm } from '../../components/confirm'
import ToolInteractionDrawer from '../ToolInteractionDrawer'
import { useInteractionStore } from '../../stores/interactionStore'

interface WorkSessionAreaProps {
  project?: IWorkProject
  session?: IWorkSession
  onSessionUpdated?: (session: IWorkSession) => void
  onSessionCreated?: (session: IWorkSession) => void
  /** 右侧探索器当前打开的文件（作为可引用上下文） */
  activeFilePath?: string | null
  onClearActiveFile?: () => void
  /** 外部注入的上下文（如编辑器选中代码） */
  pendingContext?: { kind: 'selection'; path: string; text: string; nonce: number } | null
  /** 点击路径 → 在探索器打开文件 */
  onOpenFilePath?: (path: string) => void
  /** 把命令送到内置终端执行 */
  onRunCommand?: (command: string) => void
  /** 把代码块插入编辑器光标处 */
  onInsertCode?: (code: string) => void
  /** 切换右侧工作面板显示 */
  onTogglePanel?: () => void
  /** 右侧工作面板当前是否展开 */
  panelOpen?: boolean
}

interface FileChangeMeta { path: string; action: string }
interface ApprovalRequestView { id: string; name: string; arguments: string }
/** 用量快照与 Agent 流统一类型一致，供顶栏徽标直接复用 */
type UsageView = AgentUsage

/** 流式执行时间线：思考/正文/工具/文件/检查点/子 Agent 按发生顺序 inline 展示 */
type StreamItem =
  | { kind: 'thought'; seq: number; text: string }
  | { kind: 'text'; seq: number; text: string }
  | { kind: 'tool'; seq: number; id: string; name: string; arguments: string; result?: string }
  | { kind: 'file'; seq: number; path: string; action: string }
  | { kind: 'checkpoint'; seq: number; id: string; label: string; fileCount: number }
  | { kind: 'subagent'; seq: number; id: string; description: string; stage: string; tool?: string; steps?: number; message?: string }
  | { kind: 'approval'; seq: number; id: string; name: string; arguments: string }

type WorkStreamHandlers = {
  onContent: (text: string) => void
  onThought: (text: string) => void
  onToolCall: (tc: { id: string; name: string; arguments: string }) => void
  onToolResult: (id: string, content: string) => void
  onFileChange: (fc: FileChangeMeta) => void
  onApprovalRequest: (req: ApprovalRequestView) => void
  /** 交互型工具（question / todo / plan）：统一进共享 interactionStore，由输入框上方抽屉渲染 */
  onInteraction: (evt: Record<string, unknown>) => void
  onCheckpoint: (cp: { id: string; label: string; fileCount: number }) => void
  onSubAgent: (sa: { id: string; description: string; stage: string; tool?: string; steps?: number; message?: string }) => void
  onUsage: (usage: UsageView) => void
  /** 上下文提示（自动压缩等），显示在输入框上方 */
  onNotice: (text: string) => void
}

/**
 * 把一帧工作会话 SSE 分发给对应 handler。
 * 帧解析统一走 utils/agentStream（与对话页、工作流同一份），这里只做状态归并。
 */
function dispatchWorkEvent(data: string, handlers: WorkStreamHandlers): void {
  const { event, error, plainText } = parseAgentFrame(data)

  if (error != null) {
    handlers.onContent('\n' + SSE_ERROR_PREFIX + error)
    return
  }
  if (plainText != null) {
    handlers.onContent(plainText)
    return
  }
  if (!event) return

  switch (event.type) {
    case 'content':
      handlers.onContent(event.text)
      break
    case 'thinking':
      handlers.onThought(event.text)
      break
    case 'tool_call':
      if (!event.hidden) handlers.onToolCall({ id: event.id, name: event.name, arguments: event.arguments })
      break
    case 'tool_result':
      if (!event.hidden) handlers.onToolResult(event.id, event.content)
      break
    case 'file_change':
      handlers.onFileChange({ path: event.path, action: event.action })
      break
    case 'approval_request':
      handlers.onApprovalRequest({ id: event.id, name: event.name, arguments: event.arguments })
      break
    case 'question':
    case 'todo':
    case 'plan':
      handlers.onInteraction(event as unknown as Record<string, unknown>)
      break
    case 'checkpoint':
      handlers.onCheckpoint({ id: event.id, label: event.label, fileCount: event.fileCount })
      break
    case 'subagent':
      handlers.onSubAgent(event)
      break
    case 'usage':
      handlers.onUsage(event)
      break
    case 'notice':
      handlers.onNotice(event.text)
      break
    case 'debug':
    case 'done':
    case 'search_results':
    case 'knowledge_results':
    case 'memory_results':
    case 'unknown':
      break
  }
}

const PLAN_EXECUTE_PROMPT = '按上面的计划开始执行。'

export default function WorkSessionArea({
  project,
  session,
  onSessionUpdated,
  onSessionCreated,
  activeFilePath,
  onClearActiveFile,
  pendingContext,
  onOpenFilePath,
  onRunCommand,
  onInsertCode,
  onTogglePanel,
  panelOpen,
}: WorkSessionAreaProps) {
  const queryClient = useQueryClient()
  const confirmRef = useRef(useConfirm())
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  // 本轮流式输出：思考、正文、工具、文件、检查点、审批统一按发生顺序排列
  const [streamItems, setStreamItems] = useState<StreamItem[]>([])
  const [liveUsage, setLiveUsage] = useState<UsageView | null>(null)
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const [pendingMode, setPendingMode] = useState<{ sessionId: string; value: WorkPermissionMode } | null>(null)
  const [modelOverride, setModelOverride] = useState<{ sessionId: string; value: string } | null>(null)
  const [openFeedback, setOpenFeedback] = useState('')
  // 会话级开关（与对话页共用同一套语义）：网络搜索 / 知识库 / 记忆 / 深度思考 + 图片附件
  const cachedSettings = useMemo(() => loadTopicSettings(session?.id), [session?.id])
  const [webSearch, setWebSearch] = useState(() => cachedSettings.webSearch ?? false)
  const [knowledgeBase, setKnowledgeBase] = useState(() => cachedSettings.knowledgeBase ?? false)
  const [memory, setMemory] = useState(() => cachedSettings.memory ?? false)
  const [deepThinking, setDeepThinking] = useState(() => cachedSettings.deepThinking ?? false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  // 会话信息：上下文占用 + 压缩提示（右下角环形进度 / 输入框上方提示条）
  const [contextUsage, setContextUsage] = useState<IContextUsage | null>(null)
  const [compacting, setCompacting] = useState(false)
  const [contextNotice, setContextNotice] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streamRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)

  const createSession = useMutation({
    mutationFn: workSessionService.create,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['workSessions'] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      onSessionCreated?.(created)
    },
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['workMessages', session?.id],
    queryFn: () => (session ? workSessionService.getMessages(session.id) : Promise.resolve([])),
    enabled: !!session,
  })

  // 会话级开关落 localStorage（与对话页共用同一套 key 规则，按会话隔离）
  useEffect(() => {
    if (!session) return
    saveTopicSettings(session.id, { webSearch, knowledgeBase, memory, deepThinking })
  }, [session, webSearch, knowledgeBase, memory, deepThinking])

  const { data: aiModels = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  const { data: providers = [] } = useQuery({
    queryKey: ['aiProviders'],
    queryFn: () => aiProviderService.getAll(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: openApps = [] } = useQuery({
    queryKey: ['workOpenApps'],
    queryFn: () => workOpenService.apps(),
    staleTime: 5 * 60 * 1000,
  })

  // 智能体：数据库智能体 + 本地智能体 + 项目 .github 目录自动加载的智能体（对话侧还有工作流）
  const { data: presetAgents = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
    staleTime: 5 * 60 * 1000,
  })
  const { data: localAgents = [] } = useQuery({
    queryKey: ['localPromptPresets'],
    queryFn: () => promptPresetService.getLocal(),
    staleTime: 5 * 60 * 1000,
  })
  // GitHub Copilot 兼容：项目 .github 目录下的自定义智能体自动加载
  const { data: copilotAssets } = useQuery({
    queryKey: ['workCopilotAssets', session?.projectId],
    queryFn: () => (session ? workProjectService.getCopilotAssets(session.projectId) : Promise.resolve(null)),
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
  })
  const agents: { id: string; name: string; content: string }[] = [
    ...(copilotAssets?.agents ?? []).map((a: IWorkCopilotAgent) => ({ id: a.id, name: a.name, content: a.content })),
    ...presetAgents,
    ...localAgents.map((a: { id: string; name: string; content: string }) => ({ id: a.id, name: a.name, content: a.content })),
  ]
  const [agentOverride, setAgentOverride] = useState<{ sessionId: string; value: string } | null>(null)
  const [effortOverride, setEffortOverride] = useState<{ sessionId: string; value: string } | null>(null)
  // 会话级上下文上限（token），空 = 模型支持的上限
  const [contextOverride, setContextOverride] = useState<{ sessionId: string; value: number } | null>(null)
  const selectedAgentId = session && agentOverride?.sessionId === session.id ? agentOverride.value : ''
  const setContextWindow = (value?: number) => {
    if (!session) return
    setContextOverride(value === undefined ? null : { sessionId: session.id, value })
  }

  // 消息级操作：复制 / 编辑 / 删除（与对话页同一套交互）
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  const copyMessage = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content)
      .then(() => { setCopiedMessageId(id); window.setTimeout(() => setCopiedMessageId(null), 1500) })
      .catch(() => {})
  }, [])

  const updateMessageMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => workSessionService.updateMessage(id, content),
    onSuccess: () => {
      if (session) queryClient.invalidateQueries({ queryKey: ['workMessages', session.id] })
      setEditingMessageId(null)
      setEditingContent('')
    },
  })

  const deleteMessageMutation = useMutation({
    mutationFn: (id: string) => workSessionService.deleteMessage(id),
    onSuccess: () => {
      if (session) queryClient.invalidateQueries({ queryKey: ['workMessages', session.id] })
      setEditingMessageId(null)
      setEditingContent('')
    },
  })

  const saveEditingMessage = () => {
    if (!editingMessageId || !editingContent.trim()) return
    updateMessageMutation.mutate({ id: editingMessageId, content: editingContent.trim() })
  }

  const deleteMessage = (id: string) => {
    confirmRef.current({
      message: '确定删除这条消息吗？',
      onConfirm: () => deleteMessageMutation.mutate(id),
    })
  }

  // @ 提及 / / 指令 浮层：输入中的查询词、选中项、文件候选
  const [inputMenu, setInputMenu] = useState<{ kind: 'mention' | 'slash'; query: string } | null>(null)

  const [fileCandidates, setFileCandidates] = useState<string[]>([])
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([])
  const [selectedMentions, setSelectedMentions] = useState<{ type: string; id: string; label: string }[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<{ name: string; filePath: string } | null>(null)
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null)

  // @ 引用笔记 / 笔记本 / 标签 / 知识库：与对话页共用同一份候选构建
  const noteMentionItems = useMentionItems(inputMenu?.kind === 'mention' ? inputMenu.query : null)

  // 工作流：与对话页共用同一套运行状态与交互（Code 会话不绑定话题，工作流独立运行）
  const [workflowOutput, setWorkflowOutput] = useState('')
  const workflowRun = useWorkflowRun(setWorkflowOutput)



  // 技能：数据库技能 + 本地技能目录（与对话页同源）+ 项目启用的技能（标记「项目」）
  const { data: dbSkills = [] } = useQuery({ queryKey: ['skills'], queryFn: () => skillService.getAll() })
  const { data: localSkills = [] } = useQuery({ queryKey: ['localSkills'], queryFn: () => skillService.getLocalSkills() })
  const enabledSkills = useMemo(() => {
    const seen = new Set<string>()
    const all: { id: string; name: string; description: string }[] = []
    for (const s of [
      ...(dbSkills as Array<{ id: string; name: string; description?: string; isEnabled: boolean }>),
      ...(localSkills as Array<{ id: string; name: string; description?: string; isEnabled: boolean }>),
    ]) {
      if (!s.isEnabled || seen.has(s.name)) continue
      seen.add(s.name)
      all.push({ id: s.id, name: s.name, description: s.description ?? '' })
    }
    return all
  }, [dbSkills, localSkills])
  const projectSkillIds = useMemo(() => new Set(project?.skillIds ?? []), [project?.skillIds])

  // 项目根目录文件：@ 未输入关键词时给出可直接引用的候选（Code 场景下文件比笔记更常用）
  const { data: rootEntries = [] } = useQuery({
    queryKey: ['workRootFiles', session?.projectId],
    queryFn: () => workFileService.list(session!.projectId, ''),
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
  })

  // 按 @ 查询词检索项目文件
  useEffect(() => {
    if (inputMenu?.kind !== 'mention' || !session) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const q = inputMenu.query.trim()
      if (!q) {
        // 未输入关键词：先给当前打开的文件，再补项目根目录下的文件
        const defaults = [
          ...(activeFilePath ? [activeFilePath] : []),
          ...rootEntries.filter(e => !e.isDirectory).map(e => e.path),
        ]
        if (!cancelled) setFileCandidates([...new Set(defaults)].slice(0, 12))
        return
      }
      try {
        const hits = await workFileService.search(session.projectId, q, 12)
        if (!cancelled) setFileCandidates([...new Set(hits.map(h => h.path))].slice(0, 12))
      } catch {
        if (!cancelled) setFileCandidates([])
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [inputMenu, session, activeFilePath, rootEntries])


  const menuItems: InputCommandItem[] = useMemo(() => {
    if (!inputMenu) return []
    const q = inputMenu.query.trim().toLowerCase()
    if (inputMenu.kind === 'mention') {
      // @ 引用：项目文件与项目 .github 智能体优先（Code 场景最常用），随后是笔记 / 笔记本 / 标签 / 知识库
      const items: InputCommandItem[] = []
      for (const path of fileCandidates) {
        if (q && !path.toLowerCase().includes(q)) continue
        items.push({ key: `file:${path}`, label: path, description: '项目文件', icon: <FileCode size={14} className="text-blue-500" />, tag: '文件', tagClass: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' })
      }
      for (const a of copilotAssets?.agents ?? []) {
        if (q && !a.name.toLowerCase().includes(q)) continue
        items.push({ key: `agent:${a.id}`, label: a.name, description: a.description, icon: <Bot size={14} className="text-indigo-500" />, tag: '.github 智能体', tagClass: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' })
      }
      items.push(...noteMentionItems)
      return items.slice(0, 24)
    }
    // / 指令：技能（数据库 / 本地 / 项目启用 / .github）+ .github 提示词模板
    const items: InputCommandItem[] = []
    // 内置命令：压缩上下文（调用当前模型把较早历史压成摘要）
    if (!q || 'compress'.includes(q) || '压缩'.includes(q)) {
      items.push({ key: 'command:compress', label: '/compress', description: '压缩上下文：调用当前模型把较早历史压成摘要', icon: <Gauge size={14} className="text-rose-500" />, tag: '命令', tagClass: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' })
    }
    for (const p of copilotAssets?.prompts ?? []) {
      if (q && !p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) continue
      items.push({ key: `prompt:${p.name}:${p.filePath}`, label: `/${p.name}`, description: p.description, icon: <Zap size={14} className="text-amber-500" />, tag: '.github 模板', tagClass: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' })
    }
    for (const s of enabledSkills) {
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) continue
      const inProject = projectSkillIds.has(s.id)
      items.push({ key: `skill:${s.name}`, label: `/${s.name}`, description: s.description, icon: <Braces size={14} className="text-violet-500" />, tag: inProject ? '项目技能' : '技能', tagClass: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400' })
    }
    for (const s of copilotAssets?.skills ?? []) {
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) continue
      items.push({ key: `skill:${s.name}`, label: `/${s.name}`, description: s.description, icon: <Braces size={14} className="text-violet-500" />, tag: '.github 技能', tagClass: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400' })
    }
    return items.slice(0, 20)
  }, [inputMenu, noteMentionItems, copilotAssets, fileCandidates, enabledSkills, projectSkillIds])

  // 上下文 chips：引用文件（受控于探索器）+ 注入的选中代码/粘贴路径
  const [injectedContexts, setInjectedContexts] = useState<{ id: string; kind: 'selection' | 'path'; label: string; text: string }[]>([])
  const lastContextNonce = useRef(0)
  useEffect(() => {
    if (!pendingContext || pendingContext.nonce === lastContextNonce.current) return
    lastContextNonce.current = pendingContext.nonce
    setInjectedContexts((prev) => [
      ...prev.filter((c) => !(c.kind === 'selection' && c.label === pendingContext.path)),
      { id: `sel-${pendingContext.nonce}`, kind: 'selection', label: pendingContext.path, text: pendingContext.text },
    ])
  }, [pendingContext])

  /** 粘贴：图片转附件 chip（非视觉模型会带感叹号划掉）；绝对路径转为引用 chip（不放回输入框） */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // 剪贴板里的图片/文件：挂成附件（是否可用由当前模型的视觉能力决定）
    const pastedFiles: File[] = []
    for (const item of e.clipboardData?.items ?? []) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) pastedFiles.push(file)
    }
    if (pastedFiles.length > 0) {
      e.preventDefault()
      setAttachedFiles((prev) => [...prev, ...pastedFiles])
      return
    }

    const text = e.clipboardData.getData('text/plain').trim()
    if (text.length > 260 || text.includes('\n')) return
    if (!/^[a-zA-Z]:[\\/]/.test(text) && !text.startsWith('\\\\')) return
    e.preventDefault()
    const label = text.split(/[\\/]/).pop() || text
    setInjectedContexts((prev) => [
      ...prev.filter((c) => c.label !== label),
      { id: `path-${Date.now()}`, kind: 'path', label, text: `【引用文件】${text}` },
    ])
  }

  // 快捷键：Ctrl/Cmd+L 聚焦输入框，Alt+N 新建会话
  const newSessionRef = useRef<() => void>(() => {})
  useEffect(() => {
    newSessionRef.current = () => {
      if (project) createSession.mutate({ projectId: project.id, title: '' })
    }
  }, [project, createSession])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newSessionRef.current()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 输入历史（↑/↓ 回溯）
  const [inputHistory, setInputHistory] = useState<string[]>([])


  // 长会话：旧回合默认折叠
  const [showOlder, setShowOlder] = useState(false)

  // 未手动切换过模型时，跟随会话上保存的模型
  const selectedModelId =
    session && modelOverride?.sessionId === session.id ? modelOverride.value : session?.modelId ?? ''
  const setSelectedModelId = (value: string) => {
    if (session) setModelOverride({ sessionId: session.id, value })
  }

  const permissionMode: WorkPermissionMode =
    session && pendingMode?.sessionId === session.id
      ? pendingMode.value
      : parsePermissionMode(session?.permissionMode)

  // 当前生效模型的推理模式：决定推理强度控件是下拉（native）、开关（tag）还是不显示
  // 当前生效模型：视觉能力决定图片附件入口，档位列表决定推理强度候选项
  const currentModel =
    aiModels.find((m) => m.id === selectedModelId) ??
    aiModels.find((m) => m.purpose === 'chat' && m.isDefault) ??
    aiModels.find((m) => m.purpose === 'chat')
  const currentReasoningMode = currentModel?.reasoningMode ?? 'none'
  // 未手动选择时按模型配置的强度（models.dev 导入的档位优先）
  const reasoningEffort = session && effortOverride?.sessionId === session.id
    ? effortOverride.value
    : reasoningEffortDefault(currentModel)
  const contextWindow = session && contextOverride?.sessionId === session.id ? contextOverride.value : undefined

  // Agent 模式：交互式 / 托管执行（autopilot 下写操作不再逐步确认）。以服务端会话值为准，本地仅做乐观覆盖
  const [agentModeOverride, setAgentModeOverride] = useState<{ sessionId: string; value: AgentRunMode } | null>(null)
  const agentMode = session
    ? (agentModeOverride?.sessionId === session.id ? agentModeOverride.value : parseAgentMode(session.agentMode))
    : parseAgentMode(cachedSettings.agentMode)

  const setAgentMode = (value: AgentRunMode) => {
    if (!session) return
    setAgentModeOverride({ sessionId: session.id, value })
    workSessionService
      .update(session.id, { title: session.title, modelId: session.modelId, agentMode: value })
      .then((updated) => {
        onSessionUpdated?.(updated)
        queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
      })
      .catch(() => setAgentModeOverride(null))
  }

  const setPermissionMode = (value: WorkPermissionMode) => {
    if (!session) return
    setPendingMode({ sessionId: session.id, value })
    workSessionService
      .update(session.id, { title: session.title, modelId: session.modelId, permissionMode: value })
      .then((updated) => {
        onSessionUpdated?.(updated)
        queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
      })
      .catch(() => setPendingMode(null))
  }

  /** 拉取上下文占用（打开会话信息面板、发送完成、压缩后） */
  const refreshContextUsage = () => {
    if (!session) return
    // 未手动选择窗口时按当前模型的上限展示占用率
    workSessionService
      .contextUsage(session.id, contextWindow ?? currentModel?.contextWindow)
      .then(setContextUsage)
      .catch(() => undefined)
  }

  /** /compress：调用当前模型把较早的历史压成摘要（原始消息保留在会话里） */
  const compactContext = async () => {
    if (!session || compacting) return
    setCompacting(true)
    try {
      const result = await workSessionService.compact(session.id, { contextWindow, modelId: session.modelId })
      setContextNotice(`已压缩 ${result.messageCount} 条早期消息为摘要（约 ${result.beforeTokens} → ${result.afterTokens} tokens）`)
      refreshContextUsage()
    } catch (err) {
      setContextNotice(`压缩失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCompacting(false)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamItems])

  // 会话切换 / 历史变化后刷新上下文占用（面板打开时也会主动拉一次）
  useEffect(() => {
    if (!session?.id || isStreaming) return
    // 未手动选择窗口时按当前模型的上限展示占用率
    workSessionService
      .contextUsage(session.id, contextWindow ?? currentModel?.contextWindow)
      .then(setContextUsage)
      .catch(() => undefined)
  }, [session?.id, session?.messageCount, isStreaming, contextWindow, currentModel?.contextWindow])

  // 两段输出之间的所有过程（工具调用、思考）折叠为一组，正文输出作为组分界

  // 历史消息按时间线合并渲染（避免文本与文件变更被按类型拆分导致乱序）；
  // 子 Agent 的多条进度事件按 id 去重，仅保留最终状态
  const orderedMessages = useMemo(() => {
    const parseSubagentId = (m: IWorkMessage): string | undefined => {
      if (m.type !== 'subagent') return undefined
      try { return (JSON.parse(m.metadata ?? '{}') as { id?: string }).id ?? undefined } catch { return undefined }
    }
    const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const lastOfSubagent = new Map<string, string>()
    for (const m of sorted) {
      const id = parseSubagentId(m)
      if (id) lastOfSubagent.set(id, m.id)
    }
    return sorted.filter((m) => {
      const id = parseSubagentId(m)
      return !id || lastOfSubagent.get(id) === m.id
    })
  }, [messages])

  // 长会话：默认只展示最近一轮，更早的折叠
  const lastUserIndex = useMemo(() => {
    for (let i = orderedMessages.length - 1; i >= 0; i--) {
      if (orderedMessages[i].role === 'user') return i
    }
    return -1
  }, [orderedMessages])
  const visibleMessages = showOlder || lastUserIndex <= 0 ? orderedMessages : orderedMessages.slice(lastUserIndex)
  const olderCount = showOlder || lastUserIndex <= 0 ? 0 : lastUserIndex
  // 历史消息同样折叠：两段输出之间的思考/工具调用合并为一组（与流式渲染、任务详情页一致）
  const foldedHistory = foldConsecutiveToolCalls(visibleMessages, isFoldableProcessMessage, toProcessEntry)
  const renderProcessEntry = (item: ToolCallEntry) =>
    item.kind === 'thought'
      ? <AgentThoughtBlock text={item.text ?? ''} />
      : <ChatToolCallRow name={item.name} args={item.args} result={item.result} onOpenPath={onOpenFilePath} onRunCommand={onRunCommand} />
 // 刚发出且后端尚未在历史中持久化的消息 → 派生展示（持久化后自动让位）
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user'),
    [messages],
  )
  const showPendingUser =
    pendingUser !== null && lastUserMessage?.content !== pendingUser

  const resetStreamState = () => {
    setStreamItems([])
    setLiveUsage(null)
    seqRef.current = 0
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-lg shadow-indigo-500/20">
            <Bot size={28} className="text-white" />
          </div>
          <h3 className="text-base font-medium text-gray-800 dark:text-gray-100">Code 会话</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            在左侧「项目」中选择项目或会话开始；编码 Agent 可以读写项目文件、执行开发命令、运行构建诊断，并按权限模式请求确认。
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {project && (
              <button
                onClick={() => createSession.mutate({ projectId: project.id, title: '' })}
                disabled={createSession.isPending}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                {createSession.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                在 {project.name} 新建会话
              </button>
            )}
            {onTogglePanel && (
              <button
                onClick={onTogglePanel}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[12px] font-medium text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-600"
              >
                <PanelRightOpen size={13} />
                {panelOpen ? '收起工作面板' : '打开工作面板'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const handleSend = async () => {
    const content = input.trim()
    // /compress 命令：调用当前模型压缩上下文，不发消息
    if (content === '/compress') {
      setInput('')
      setInputHistory((prev) => [...prev.slice(-49), content])
      await compactContext()
      return
    }
    // 选中工作流时：本轮交给工作流执行（与对话页同一套运行逻辑）
    if (workflowRun.workflow) {
      setInput('')
      setInputHistory((prev) => [...prev.slice(-49), content])
      setSelectedMentions([])
      setMentionedFiles([])
      setInjectedContexts([])
      await workflowRun.run(buildContent(content), undefined, permissionMode)
      return
    }
    setInput('')

    setInputHistory((prev) => [...prev.slice(-49), content])
    setInjectedContexts([])
    setMentionedFiles([])
    setSelectedMentions([])
    setSelectedPrompt(null)
    setSelectedSkillName(null)

    // 图片附件（视觉模型）：与对话页同一份 base64 组装；非视觉模型忽略（chip 已划掉提示）
    const images: { data: string; mimeType: string; fileName?: string }[] = []
    if (currentModel?.supportsVision) {
      for (const file of attachedFiles) {
        if (file.type.startsWith('image/')) {
          images.push({ data: await fileToBase64(file), mimeType: file.type, fileName: file.name })
        }
      }
    }
    setAttachedFiles([])

    await runStream(buildContent(content), permissionMode, true, images)
  }

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  /** 把上下文 chips 组装进提示词 */
  const buildContent = (raw: string): string => {
    const parts: string[] = []
    if (activeFilePath) parts.push(`【引用文件】${activeFilePath}`)
    for (const c of injectedContexts) {
      if (c.kind === 'selection') parts.push(`【选中代码 · ${c.label}】\n\`\`\`\n${c.text}\n\`\`\``)
      else parts.push(`【引用文件】${c.label}`)
    }
    for (const path of mentionedFiles) parts.push(`【引用文件】${path}`)
    if (selectedPrompt) parts.push(`【提示词模板 /${selectedPrompt.name}】请按 .github 中该模板的步骤执行。`)
    if (parts.length === 0) return raw
    return `${parts.join('\n')}\n\n${raw}`
  }

  /** 移除输入框中正在输入的 @查询词 */
  const stripMentionQuery = () => {
    const at = input.lastIndexOf('@')
    if (at < 0) return
    let end = at + 1
    while (end < input.length && !/\s/.test(input[end])) end++
    setInput((input.slice(0, at) + input.slice(end)).replace(/^\s+/, '').replace(/\s+$/, ''))
  }

  /** 选中 @ 智能体：切换本会话 Agent（与工具栏下拉一致），并移除输入中的 @查询词 */
  const applyMenuAgent = (agentId: string) => {
    if (session) setAgentOverride({ sessionId: session.id, value: agentId })
    stripMentionQuery()
    setInputMenu(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  /** 选中 @ 文件：替换输入中的 @查询词 并加入引用 chips */
  const applyMentionFile = (path: string) => {
    stripMentionQuery()
    setMentionedFiles(prev => (prev.includes(path) ? prev : [...prev, path]))
    setInputMenu(null)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }

  /** 选中 @ 笔记/笔记本/标签/知识库：加入引用 chips，内容由后端按 id 注入 */
  const applyMention = (item: InputCommandItem) => {
    const [type, id] = item.key.split(':')
    stripMentionQuery()
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

  /** 选中 / 指令：提示词模板或项目技能 */
  const applySlashItem = (item: InputCommandItem) => {
    if (item.key.startsWith('prompt:')) {
      const rest = item.key.slice('prompt:'.length)
      const sep = rest.indexOf(':')
      const name = sep > 0 ? rest.slice(0, sep) : rest
      const filePath = sep > 0 ? rest.slice(sep + 1) : ''
      setSelectedPrompt({ name, filePath })
    } else if (item.key.startsWith('skill:')) {
      setSelectedSkillName(item.key.slice('skill:'.length))
    }
    // 移除输入框开头的 /查询词，保留其余内容
    const spaceIdx = input.indexOf(' ')
    const next = spaceIdx >= 0 ? input.slice(spaceIdx + 1) : ''
    setInput(next.replace(/^\s+/, ''))
    setInputMenu(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  /** 预设提示词直达发送（诊断 / 起步 chips / 后续建议共用） */
  const sendPreset = (text: string) => {
    if (!session || isStreaming) return
    setInputHistory((prev) => [...prev.slice(-49), text])
    void runStream(buildContent(text), permissionMode)
  }

  /** 重新生成：重跑最后一条用户消息，不重复落库该消息 */
  const retryLast = async () => {
    if (!session || isStreaming) return
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    await runStream(lastUser.content, permissionMode, false)
  }

  /** 计划模式：切到执行模式并把计划交给 Agent 落地 */
  const executePlan = async () => {
    if (!session || isStreaming) return
    setPermissionMode('auto')
    await runStream(PLAN_EXECUTE_PROMPT, 'auto')
  }

  const runStream = async (
    content: string,
    mode: WorkPermissionMode,
    persistUserMessage = true,
    images: { data: string; mimeType: string; fileName?: string }[] = [],
  ) => {
    if (!session) return
    setIsStreaming(true)
    if (persistUserMessage) setPendingUser(content)
    resetStreamState()
    useInteractionStore.getState().clear(session.id)

    const controller = new AbortController()
    streamRef.current = controller
   const handlers: WorkStreamHandlers = {
      onContent: (text) => setStreamItems((prev) => {
        const last = prev[prev.length - 1]
        // 连续的正文增量合并为一项，遇到其他事件就另起一项，保证顺序可见
        if (last && last.kind === 'text') return [...prev.slice(0, -1), { ...last, text: last.text + text }]
        return [...prev, { kind: 'text', seq: seqRef.current++, text }]
      }),
      onThought: (text) => setStreamItems((prev) => {
        const last = prev[prev.length - 1]
        if (last && last.kind === 'thought') return [...prev.slice(0, -1), { ...last, text: last.text + text }]
        return [...prev, { kind: 'thought', seq: seqRef.current++, text }]
      }),
      onToolCall: (tc) => setStreamItems((prev) => {
        const idx = prev.findIndex((x) => x.kind === 'tool' && x.id === tc.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...tc } as StreamItem
          return next
        }
        return [...prev, { kind: 'tool', seq: seqRef.current++, ...tc } as StreamItem]
      }),
      onToolResult: (id, result) => setStreamItems((prev) =>
        prev.map((x) => (x.kind === 'tool' && x.id === id ? { ...x, result } : x)),
      ),
      onFileChange: (fc) => setStreamItems((prev) => {
        const idx = prev.findIndex((x) => x.kind === 'file' && x.path === fc.path)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...fc } as StreamItem
          return next
        }
        return [...prev, { kind: 'file', seq: seqRef.current++, ...fc } as StreamItem]
      }),
      onApprovalRequest: (req) => setStreamItems((prev) => [
        ...prev.filter((x) => !(x.kind === 'approval' && x.id === req.id)),
        { kind: 'approval', seq: seqRef.current++, ...req },
      ]),
      onInteraction: (evt) => useInteractionStore.getState().applyChunk(session.id, evt),
      onCheckpoint: (cp) => setStreamItems((prev) => [...prev, { kind: 'checkpoint', seq: seqRef.current++, ...cp } as StreamItem]),
      onSubAgent: (sa) => setStreamItems((prev) => {
        const idx = prev.findIndex((x) => x.kind === 'subagent' && x.id === sa.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...sa } as StreamItem
          return next
        }
        return [...prev, { kind: 'subagent', seq: seqRef.current++, ...sa } as StreamItem]
      }),
      onUsage: (usage) => setLiveUsage(usage),
      onNotice: (text) => { setContextNotice(text); refreshContextUsage() },
    }
     try {
      const response = await workSessionService.stream(
        session.id,
        {
          content,
          modelId: selectedModelId || undefined,
          enableTools: true,
          permissionMode: mode,
          reasoningEffort: reasoningEffort || undefined,
          agentPrompt: selectedAgentId ? agents.find((a) => a.id === selectedAgentId)?.content : undefined,
          promptFile: selectedPrompt?.filePath || undefined,
          skillName: selectedSkillName || undefined,
          mentions: selectedMentions.length > 0 ? selectedMentions.map((m) => ({ type: m.type, id: m.id })) : undefined,
          // 会话级上下文上限（选择更小的窗口时后端按预算裁剪历史）
          contextWindow,
          // Agent 模式：交互式逐步确认 / autopilot 自动执行
          agentMode,
          // 与对话会话共用同一套开关语义：网络搜索 / 知识库 / 记忆 / 深度思考
          webSearch,
          knowledgeBase,
          memory,
          deepThinking,
          images: images.length > 0 ? images : undefined,
          persistUserMessage,
        },
        controller.signal,
      )
      await consumeSseStream(response, ({ data }) => dispatchWorkEvent(data, handlers), { signal: controller.signal })
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('Work stream error:', error)
        handlers.onContent('\n流式输出失败，请检查模型配置。')
      }
    } finally {
      streamRef.current = null
      setIsStreaming(false)
      queryClient.invalidateQueries({ queryKey: ['workMessages', session.id] })
      queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      queryClient.invalidateQueries({ queryKey: ['workFileChanges', session.id] })
      queryClient.invalidateQueries({ queryKey: ['workCheckpoints', session.id] })
      workSessionService.getById(session.id).then((s) => onSessionUpdated?.(s)).catch(() => {})
    }
  }
    const submitApproval = (id: string, approve: boolean) => {
      if (!session) return
      setStreamItems((prev) => prev.filter((x) => !(x.kind === 'approval' && x.id === id)))
      workSessionService.approve(session.id, id, approve).catch(() => {})
    }

    /** 回滚到检查点：与历史消息里的检查点行共用同一逻辑（confirm 为回调式，确认后才执行） */
    const restoreCheckpoint = (id: string) => {
      if (!id) return
      confirmRef.current({
        message: '确定回滚到此检查点吗？工作区相关文件将被覆盖。',
        onConfirm: () => {
          workCheckpointService.restore(id).catch(() => {})
        },
      })
    }


  /** 导出会话为 Markdown */
  const exportMarkdown = () => {
    if (!session) return
    const lines: string[] = [`# ${session.title || '工作会话'}`, '']
    for (const m of orderedMessages) {
      if (m.type === 'file_change') {
        let meta: FileChangeMeta = { path: '', action: 'write' }
        try { meta = JSON.parse(m.metadata ?? '{}') } catch { /* 使用默认值 */ }
        const label = meta.action === 'create' ? '新建' : meta.action === 'delete' ? '删除' : '修改'
        lines.push(`- 📄 ${label} \`${meta.path}\``)
      } else if (m.type === 'thought') {
        lines.push('<details><summary>思考过程</summary>', '', m.content, '', '</details>')
      } else if (m.type === 'tool') {
        let meta: { name: string } = { name: '' }
        try { meta = { ...meta, ...JSON.parse(m.metadata ?? '{}') } } catch { /* 使用默认值 */ }
        lines.push(`<details><summary>🔧 ${meta.name || '工具调用'}</summary>`, '', '```', m.content, '```', '', '</details>')
      } else if (m.type === 'subagent') {
        lines.push(`- 🤖 子 Agent：${m.content}`)
      } else if (m.type === 'checkpoint') {
        lines.push(`- 📌 检查点：${m.content}`)
      } else if (m.role === 'user') {
        lines.push('## 我', '', m.content, '')
      } else if (m.type === 'system') {
        lines.push(`> ${m.content}`, '')
      } else {
        lines.push('## Agent', '', m.content, '')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${session.title || 'work-session'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpen = async (app: string) => {
    if (!project) return
    try {
      const message = await workProjectService.open(project.id, app)
      setOpenFeedback(message || '已打开')
    } catch (e) {
      setOpenFeedback(`打开失败：${(e as Error).message}`)
    }
    setTimeout(() => setOpenFeedback(''), 2500)
  }

  const copyRootPath = () => {
    if (!project) return
    navigator.clipboard.writeText(project.rootPath)
      .then(() => setOpenFeedback('项目路径已复制'))
      .catch(() => setOpenFeedback('复制失败'))
    setTimeout(() => setOpenFeedback(''), 2500)
  }

  const usageTotal: UsageView = liveUsage ?? {
    promptTokens: session.promptTokens ?? 0,
    completionTokens: session.completionTokens ?? 0,
    cachedTokens: session.cachedTokens ?? 0,
    totalTokens: session.totalTokens ?? 0,
    latencyMs: 0,
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
      {/* 头部：标题与统计在左，打开方式与用量在右 */}
      <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${isStreaming ? 'animate-pulse bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          title={isStreaming ? '运行中' : '空闲'}
        />
        <h2 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{session.title || '新会话'}</h2>
        <span className="hidden shrink-0 text-[11px] text-gray-400 sm:inline">
          {project ? `${project.name} · ` : ''}{messages.length} 条消息
          {session.turnCount > 0 && ` · ${session.turnCount} 轮`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <AgentUsageBadge
            usage={usageTotal}
            className="hidden bg-gray-100 dark:bg-gray-800 sm:inline-flex"
          />
          {project && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => createSession.mutate({ projectId: project.id, title: '' })}
                disabled={createSession.isPending}
                title="新建会话（Alt+N）"
                aria-label="新建会话"
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                {createSession.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
              <button
                onClick={exportMarkdown}
                title="导出会话为 Markdown"
                aria-label="导出会话为 Markdown"
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                <Download size={14} />
              </button>
              <OpenWithButton
                apps={openApps}
                onOpen={handleOpen}
                onCopyPath={copyRootPath}
              />
            </div>
          )}
          {onTogglePanel && (
            <button
              onClick={onTogglePanel}
              title={panelOpen ? '收起工作面板' : '展开工作面板'}
              aria-label={panelOpen ? '收起工作面板' : '展开工作面板'}
              className={`rounded-lg p-1.5 transition-colors ${
                panelOpen
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'
              }`}
            >
              {panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
          )}
        </div>
        {openFeedback && (
          <span className="absolute right-4 top-12 z-10 rounded-lg bg-gray-900 px-2.5 py-1 text-[11px] text-white shadow-lg dark:bg-gray-700">
            {openFeedback}
          </span>
        )}
      </div>

      {/* 消息区：瀑布流 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
          {olderCount > 0 && (
            <button
              onClick={() => setShowOlder(true)}
              className="mx-auto flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <ChevronDown size={11} />展开更早的 {olderCount} 条消息
            </button>
          )}
          {foldedHistory.map((entry, i) => {
            if (entry.kind === 'tool') {
              const only = entry.items[0]
              return entry.items.length === 1
                ? <Fragment key={only.id ?? i}>{renderProcessEntry(only)}</Fragment>
                : <ToolCallGroup key={only.id ?? i} items={entry.items} renderItem={renderProcessEntry} />
            }
            const msg = entry.item
            return isProcessMessage(msg)
              ? <ProcessMessageRow key={msg.id} message={msg} onOpenFilePath={onOpenFilePath} onRunCommand={onRunCommand} />
              : (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  onOpenFilePath={onOpenFilePath}
                  onCodeAction={(code, action) => { if (action === 'insert') onInsertCode?.(code) }}
                  isEditing={editingMessageId === msg.id}
                  editingContent={editingMessageId === msg.id ? editingContent : ''}
                  isCopied={copiedMessageId === msg.id}
                  actionsDisabled={isStreaming || updateMessageMutation.isPending || deleteMessageMutation.isPending}
                  onCopy={copyMessage}
                  onStartEdit={(id, content) => { setEditingMessageId(id); setEditingContent(content) }}
                  onSaveEdit={saveEditingMessage}
                  onCancelEdit={() => { setEditingMessageId(null); setEditingContent('') }}
                  onDelete={deleteMessage}
                  onEditContentChange={setEditingContent}
                />
              )
          })}

          {/* 空会话：快捷起步 */}
          {!isStreaming && lastUserIndex < 0 && (
            <div className="flex flex-wrap gap-1.5">
              {['解释这个项目是做什么的', '修复构建错误', '搜索与登录相关的代码', '总结 README 的要点'].map((t) => (
                <button
                  key={t}
                  onClick={() => sendPreset(t)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-600"
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* 刚发出、后端尚在持久化的消息（即时反馈） */}
          {showPendingUser && pendingUser && (
            <div className="flex flex-row-reverse gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
                <User size={15} />
              </div>
              <div className="flex max-w-[85%] flex-col items-end">
                <div className="rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-3 text-sm text-white shadow-sm">{pendingUser}</div>
              </div>
            </div>
            )}

            {/* 本轮流式输出：思考、审批/追问、工具、正文按发生顺序穿插展示（与对话页/任务看板共用 AgentTimeline） */}
            {isStreaming && (
              <div className="space-y-2">
                <AgentTimeline
                  items={fromWorkStreamItems(streamItems)}
                  streaming
                  onOpenPath={onOpenFilePath}
                  onRunCommand={onRunCommand}
                  onInsertCode={(code) => onInsertCode?.(code)}
                  onApprove={(id, approved) => submitApproval(id, approved)}
                  onRestoreCheckpoint={(id) => restoreCheckpoint(id)}
                  emptyHint={(
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Loader2 size={14} className="animate-spin" />
                      思考中...
                    </div>
                  )}
                />
              </div>
            )}

          {/* 工作流：节点状态 / Human 审批 / Agent 工具交互（与对话页共用同一组件） */}
          {workflowRun.workflow && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
                <GitBranch size={14} className="shrink-0 text-blue-500" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-blue-600 dark:text-blue-400">工作流：{workflowRun.workflow.name}</span>
                <button
                  onClick={() => workflowRun.setWorkflow(null)}
                  aria-label="取消工作流"
                  className="shrink-0 text-blue-400 hover:text-blue-600"
                >
                  <X size={14} />
                </button>
              </div>
              {workflowRun.nodes.length > 0 && (
                <InlineWorkflowPanel
                  workflow={workflowRun.workflow}
                  nodeStates={workflowRun.nodes}
                  pendingApproval={workflowRun.pendingApproval}
                  workflowToolCall={workflowRun.toolCall}
                  onApprove={workflowRun.approve}
                  onToolApprove={workflowRun.submitToolInteraction}
                  isStreaming={isStreaming}
                  error={workflowRun.error}
                />
              )}
              {workflowOutput && (
                <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
                  <ThemedMarkdown source={workflowOutput} onCodeAction={(code, action) => { if (action === 'insert') onInsertCode?.(code) }} />
                </div>
              )}
            </div>
          )}

          {/* 计划模式：一键转执行 */}
          {permissionMode === 'plan' && !isStreaming && (            <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 dark:border-sky-800/50 dark:bg-sky-950/20">
              <ListChecks size={15} className="shrink-0 text-sky-500" />
              <span className="min-w-0 flex-1 text-[12px] text-sky-800 dark:text-sky-300">
                计划模式只做只读调研；确认计划后切换到执行模式落地。
              </span>
              <button
                onClick={executePlan}
                className="shrink-0 rounded-lg bg-sky-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-sky-600"
              >
                按计划执行
              </button>
            </div>
          )}

          {/* 后续建议 + 重新生成 */}
          {!isStreaming && orderedMessages.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {['继续实现', '补充单元测试', '解释上面的改动'].map((t) => (
                <button
                  key={t}
                  onClick={() => sendPreset(t)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-600"
                >
                  {t}
                </button>
              ))}
              <button
                onClick={() => void retryLast()}
                title="用最后一条输入重新生成"
                className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <RotateCcw size={11} />重新生成
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>


        {/* 输入区：与对话页共用 AgentInputBox（浮层 / chips / 历史回溯 / 发送-停止），工具栏为编码会话独有 */}
        <AgentInputBox
          value={input}
          onChange={(v) => setInput(v)}
          onMenuChange={setInputMenu}
          onSubmit={handleSend}
          onPaste={handlePaste}
          textareaRef={textareaRef}
          menu={inputMenu && !isStreaming
            ? {
                kind: inputMenu.kind,
                items: menuItems,
                onSelect: (item) => {
                  if (item.key === 'command:compress') { setInput(''); void compactContext(); return }
                  if (item.key.startsWith('agent:')) applyMenuAgent(item.key.slice('agent:'.length))
                  else if (item.key.startsWith('file:')) applyMentionFile(item.key.slice('file:'.length))
                  else if (/^(note|notebook|tag|knowledge):/.test(item.key)) applyMention(item)
                  else applySlashItem(item)
                },
                emptyHint: inputMenu.query.trim() ? '没有匹配项' : '输入关键词搜索...',
              }
            : null}
          chips={[
            ...attachedFiles.map((file, i) => ({
              id: `attach:${i}`,
              label: file.name,
              tone: 'amber' as const,
              // 非视觉模型：粘贴进来的图片前加感叹号并划掉（发送时会跳过）
              struck: !currentModel?.supportsVision,
              title: currentModel?.supportsVision ? '图片附件' : `${file.name}（当前模型不支持图片输入，发送时会忽略）`,
              onRemove: () => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i)),
            })),
            ...(activeFilePath
              ? [{
                  id: `active:${activeFilePath}`,
                  label: activeFilePath,
                  tone: 'blue' as const,
                  title: `引用文件：${activeFilePath}`,
                  onRemove: () => onClearActiveFile?.(),
                }]
              : []),
            ...injectedContexts.map((c) => ({
              id: c.id,
              label: c.kind === 'selection' ? `选中 ${c.label}` : c.label,
              tone: 'amber' as const,
              title: c.kind === 'selection' ? c.text.slice(0, 200) : c.text,
              onRemove: () => setInjectedContexts((prev) => prev.filter((x) => x.id !== c.id)),
            })),
            ...mentionedFiles.map((path) => ({
              id: `file:${path}`,
              label: path,
              tone: 'blue' as const,
              onRemove: () => setMentionedFiles((prev) => prev.filter((p) => p !== path)),
            })),
            ...selectedMentions.map((m) => ({
              id: `${m.type}:${m.id}`,
              label: m.label,
              tone: 'blue' as const,
              onRemove: () => setSelectedMentions((prev) => prev.filter((x) => !(x.type === m.type && x.id === m.id))),
            })),
            ...(selectedPrompt
              ? [{
                  id: `prompt:${selectedPrompt.filePath}`,
                  label: `/${selectedPrompt.name}`,
                  tone: 'amber' as const,
                  onRemove: () => setSelectedPrompt(null),
                }]
              : []),
            ...(selectedSkillName
              ? [{
                  id: `skill:${selectedSkillName}`,
                  label: `/${selectedSkillName}`,
                  tone: 'violet' as const,
                  onRemove: () => setSelectedSkillName(null),
                }]
              : []),
          ]}
          aboveInput={session ? (
            <>
              {/* 上下文提示：自动压缩 / /compress 结果 */}
              {contextNotice && (
                <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <Gauge size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">{contextNotice}</span>
                  <button onClick={() => setContextNotice(null)} aria-label="关闭提示" className="shrink-0 opacity-60 transition-opacity hover:opacity-100">
                    <X size={12} />
                  </button>
                </div>
              )}
              <ToolInteractionDrawer streamKey={session.id} streaming={isStreaming} />
            </>
          ) : undefined}
          trailing={
            <AgentContextUsage
              usage={contextUsage}
              onRefresh={refreshContextUsage}
              onCompact={() => void compactContext()}
              compacting={compacting}
            />
          }
          footerLeading={session ? (
            <>
              {/* Agent 模式 + 审批模式：放在聊天框下方（左下角） */}
              <AgentModeSelect value={agentMode} onChange={(v) => setAgentMode(v as AgentRunMode)} />
              <AgentPermissionSelect
                value={permissionMode}
                onChange={(v) => setPermissionMode(v as WorkPermissionMode)}
              />
            </>
          ) : undefined}
          placeholder="描述你要完成的开发任务，/ 用模板或技能，@ 引用笔记、文件或智能体（↑ 回溯历史输入）"
          streaming={isStreaming}
          onStop={() => streamRef.current?.abort()}
          canSubmit={!!session && (!!input.trim() || !!selectedPrompt || !!selectedSkillName || selectedMentions.length > 0)}
          history={inputHistory}
          hint="Enter 发送 · Shift+Enter 换行 · ↑ 历史 · Ctrl+L 聚焦"
          toolbar={
            <>
              {/* 图片附件：不放入口按钮，直接粘贴图片即可（非视觉模型的粘贴会带感叹号划掉） */}

              {/* 智能体 / 模型 / 推理强度：与对话页共用同一套选择器（Agent 模式与审批模式已移到输入框下方） */}
              <AgentPicker
                items={[
                  ...presetAgents.map((a) => ({ id: a.id, name: a.name, description: a.content?.slice(0, 120), icon: 'bot' as const })),
                  ...localAgents.map((a) => ({ id: a.id, name: a.name, description: a.content?.slice(0, 120), icon: 'bot' as const, badge: '本地' })),
                ]}
                value={selectedAgentId}
                onSelect={(item) => {
                  workflowRun.setWorkflow(null)
                  if (session) setAgentOverride({ sessionId: session.id, value: item.id })
                }}
                projectItems={(copilotAssets?.agents ?? []).map((a) => ({ id: a.id, name: a.name, description: a.description, icon: 'bot' as const }))}
                projectValue={selectedAgentId}
                onSelectProject={(item) => {
                  workflowRun.setWorkflow(null)
                  if (session) setAgentOverride({ sessionId: session.id, value: item.id })
                }}
                workflows={workflowRun.workflows.map((w) => ({ id: w.id, name: w.name, description: w.description, icon: 'git' as const }))}
                workflowValue={workflowRun.workflow?.id}
                onSelectWorkflow={(item) => {
                  const workflow = workflowRun.workflows.find((w) => w.id === item.id)
                  if (workflow) {
                    if (session) setAgentOverride({ sessionId: session.id, value: '' })
                    workflowRun.setWorkflow(workflow)
                  }
                }}
                placeholder="默认 Agent"
              />
              <AgentModelPicker
                models={aiModels
                  .filter((m) => m.purpose === 'chat' && m.providerId)
                  .map((m) => ({
                    id: m.id,
                    displayName: m.displayName,
                    providerId: m.providerId,
                    contextWindow: m.contextWindow,
                    reasoningMode: m.reasoningMode,
                    reasoningEffort: m.reasoningEffort,
                    reasoningEfforts: m.reasoningEfforts,
                  }))}
                providers={providers.map((p) => ({ id: p.id, name: p.name }))}
                modelId={selectedModelId}
                onModelChange={(id) => { setSelectedModelId(id); setEffortOverride(null); setContextOverride(null) }}
                effort={reasoningEffort}
                onEffortChange={(v) => session && setEffortOverride({ sessionId: session.id, value: v })}
                contextWindow={contextWindow}
                onContextWindowChange={setContextWindow}
              />
              <AgentReasoningSelect
                value={reasoningEffort}
                onChange={(v) => session && setEffortOverride({ sessionId: session.id, value: v })}
                reasoningMode={currentReasoningMode === 'tag' ? 'tag' : 'none'}
                model={currentModel}
                enabled={deepThinking}
                onEnabledChange={setDeepThinking}
              />

              <div className="mx-0.5 h-4 w-px bg-gray-200 dark:bg-gray-700" />

              {/* 与对话页一致的开关：网络搜索 / 知识库 / 记忆 */}
              <button
                onClick={() => setWebSearch(!webSearch)}
                title="网络搜索"
                aria-label="网络搜索"
                className={`flex h-[27px] shrink-0 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium transition-colors ${
                  webSearch
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
                }`}
              >
                <Globe size={13} />网络搜索
              </button>
              <button
                onClick={() => setKnowledgeBase(!knowledgeBase)}
                title="知识库"
                aria-label="知识库"
                className={`flex h-[27px] shrink-0 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium transition-colors ${
                  knowledgeBase
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
                }`}
              >
                <Database size={13} />知识库
              </button>
              <button
                onClick={() => setMemory(!memory)}
                title="记忆"
                aria-label="记忆"
                className={`flex h-[27px] shrink-0 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium transition-colors ${
                  memory
                    ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                    : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
                }`}
              >
                <Atom size={13} />记忆
              </button>

              {/* 诊断：仅在打开了项目（Code 上下文）时提供 */}
              {project && (
                <button
                  onClick={() => sendPreset(`运行构建诊断${project.diagnosticsCommand ? `（${project.diagnosticsCommand}）` : ''}，汇总错误与警告并给出修复建议`)}
                  disabled={isStreaming}
                  title="运行构建诊断并汇报"
                  aria-label="运行构建诊断"
                  className="flex h-[27px] shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/60"
                >
                  <Stethoscope size={12} />诊断
                </button>
              )}
            </>
          }
        />
    </div>
    )
  }

  const OPEN_APP_STORAGE_KEY = 'hetu-work-open-app'

  const OPEN_APP_FALLBACK_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  terminal: SquareTerminal,
}

/** 应用图标：优先用后端提取的真实图标，加载失败回退通用图标 */
function AppIcon({ app, iconUrl, size = 14 }: { app: string; iconUrl?: string; size?: number }) {
  const [ok, setOk] = useState(true)
  const Fallback = OPEN_APP_FALLBACK_ICONS[app] ?? FolderOpen
  if (iconUrl && ok) {
    return <img src={iconUrl} alt="" width={size} height={size} className="shrink-0 rounded-sm" onError={() => setOk(false)} />
  }
  return <Fallback size={size} className="shrink-0" />
}

/** 打开方式：图标按钮记住上次选择（默认第一个可用应用）直接打开，下拉切换应用 */
function OpenWithButton({ apps, onOpen, onCopyPath }: { apps: IWorkOpenApp[]; onOpen: (app: string) => void; onCopyPath: () => void }) {
  const available = useMemo(() => apps.filter((a) => a.available), [apps])
  const [lastApp, setLastApp] = useState<string>(() => localStorage.getItem(OPEN_APP_STORAGE_KEY) ?? '')
  const [menuOpen, setMenuOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const current = available.find((a) => a.app === lastApp) ?? available[0]

  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menuOpen])

  if (!current) return null

  const choose = (app: string) => {
    setLastApp(app)
    localStorage.setItem(OPEN_APP_STORAGE_KEY, app)
    setMenuOpen(false)
    onOpen(app)
  }

  return (
    <div ref={containerRef} className="relative flex items-center">
      <button
        onClick={() => onOpen(current.app)}
        title={`用${current.label}打开项目`}
        aria-label={`用${current.label}打开项目`}
        className="rounded-l-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        <AppIcon app={current.app} iconUrl={current.iconUrl} />
      </button>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        title="选择打开方式"
        aria-label="选择打开方式"
        className="rounded-r-lg border border-l-0 border-gray-200 p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <ChevronDown size={12} />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-9 z-50 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {available.map((a) => (
            <button
              key={a.app}
              onClick={() => choose(a.app)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${a.app === current.app ? 'text-blue-600 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'}`}
            >
              <AppIcon app={a.app} iconUrl={a.iconUrl} size={13} />
              <span className="flex-1">{a.label}</span>
              {a.app === current.app && <Check size={12} className="shrink-0" />}
            </button>
          ))}
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            onClick={() => { setMenuOpen(false); onCopyPath() }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
          >
            <Copy size={13} className="shrink-0" />
            复制项目路径
          </button>
        </div>
      )}
    </div>
  )
}

/** 消息级操作（复制 / 编辑 / 删除）：与对话页同一套交互 */
interface MessageActions {
  isEditing: boolean
  editingContent: string
  isCopied: boolean
  actionsDisabled: boolean
  onCopy: (id: string, content: string) => void
  onStartEdit: (id: string, content: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  onEditContentChange: (value: string) => void
}

/** 编辑态编辑器：对话框（对话页）与编码会话共用同一份交互 */
function MessageEditor({ value, disabled, onChange, onCancel, onSave }: {
  value: string
  disabled: boolean
  onChange: (v: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-28 w-full rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-900 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          <X size={14} />
        </button>
        <button
          onClick={onSave}
          disabled={!value.trim() || disabled}
          className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  )
}

/** 操作栏：复制 / 编辑 / 删除，悬停整行提亮 */
function MessageActionBar({ message, actions }: { message: IWorkMessage; actions: MessageActions }) {
  return (
    <div className="mt-1 flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
      <button
        onClick={() => actions.onCopy(message.id, message.content)}
        title="复制"
        aria-label="复制"
        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        {actions.isCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      </button>
      <button
        onClick={() => actions.onStartEdit(message.id, message.content)}
        disabled={actions.actionsDisabled}
        title="编辑"
        aria-label="编辑"
        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <Pencil size={12} />
      </button>
      <button
        onClick={() => actions.onDelete(message.id)}
        disabled={actions.actionsDisabled}
        title="删除"
        aria-label="删除"
        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-gray-800"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function UserBubble({ message, actions }: { message: IWorkMessage; actions?: MessageActions }) {
  const editing = actions?.isEditing === true
  return (
    <div className="group flex flex-row-reverse gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
        <User size={15} />
      </div>
      <div className="flex min-w-0 max-w-[85%] flex-col items-end">
        <div className="flex items-center gap-2 px-1 pb-0.5">
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">我</span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">{formatTime(message.createdAt)}</span>
        </div>
        {editing && actions ? (
          <div className="w-full min-w-[280px] rounded-2xl rounded-tr-sm border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
            <MessageEditor
              value={actions.editingContent}
              disabled={actions.actionsDisabled}
              onChange={actions.onEditContentChange}
              onCancel={actions.onCancelEdit}
              onSave={actions.onSaveEdit}
            />
          </div>
        ) : (
          <div className="rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-3 text-sm text-white shadow-sm">
            {message.content}
          </div>
        )}
        {!editing && actions && <MessageActionBar message={message} actions={actions} />}
      </div>
    </div>
  )
}

function AgentTextBlock({ message, onCodeAction, actions }: {
  message: IWorkMessage
  onCodeAction?: (code: string, action: 'copy' | 'insert') => void
  actions?: MessageActions
}) {
  if (message.type === 'system') {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-gray-100 px-3 py-1 text-[11px] text-gray-400 dark:bg-gray-800/70 dark:text-gray-500">{message.content}</p>
      </div>
    )
  }
  const editing = actions?.isEditing === true
  return (
    <div className="group">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">Agent</span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">{formatTime(message.createdAt)}</span>
      </div>
      {editing && actions ? (
        <MessageEditor
          value={actions.editingContent}
          disabled={actions.actionsDisabled}
          onChange={actions.onEditContentChange}
          onCancel={actions.onCancelEdit}
          onSave={actions.onSaveEdit}
        />
      ) : (
        <>
          <div className="text-sm leading-relaxed text-gray-800 dark:text-gray-100">
            <ThemedMarkdown source={message.content} onCodeAction={onCodeAction} />
          </div>
          {(message.totalTokens ?? 0) > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400">
              <Coins size={10} />
              <span>
                {formatTokens(message.totalTokens ?? 0)} tokens
                {message.cachedTokens ? `（缓存 ${formatTokens(message.cachedTokens)}）` : ''}
                {message.latencyMs ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : ''}
              </span>
            </div>
          )}
          {actions && <MessageActionBar message={message} actions={actions} />}
        </>
      )}
    </div>
  )
}

/** 历史消息中的过程事件（思考 / 工具调用 / 子 Agent）：与流式时间线共用同一套行组件 */
function ProcessMessageRow({ message, onOpenFilePath, onRunCommand }: {
  message: IWorkMessage
  onOpenFilePath?: (path: string) => void
  onRunCommand?: (command: string) => void
}) {
  if (message.type === 'thought') return <AgentThoughtBlock text={message.content} />
  if (message.type === 'tool') {
    let meta: { name: string; arguments: string } = { name: '', arguments: '{}' }
    try { meta = { ...meta, ...JSON.parse(message.metadata ?? '{}') } } catch { /* 使用默认值 */ }
    return (
      <ChatToolCallRow
        name={meta.name}
        args={meta.arguments}
        result={message.content}
        onOpenPath={onOpenFilePath}
        onRunCommand={onRunCommand}
      />
    )
  }
  let meta: { stage: string; tool?: string; steps?: number; message?: string } = { stage: 'done' }
  try { meta = { ...meta, ...JSON.parse(message.metadata ?? '{}') } } catch { /* 使用默认值 */ }
  return <AgentSubAgentRow description={message.content} stage={meta.stage} tool={meta.tool} steps={meta.steps} message={meta.message} />
}

const isProcessMessage = (m: IWorkMessage) => m.type === 'thought' || m.type === 'tool' || m.type === 'subagent'

/** 可折叠的过程消息：思考与工具调用（子 Agent、文件变更等保持独立行） */
const isFoldableProcessMessage = (m: IWorkMessage) => m.type === 'thought' || m.type === 'tool'

/** 过程消息 → 折叠条目（展示内容与 ProcessMessageRow 一致） */
function toProcessEntry(message: IWorkMessage): ToolCallEntry {
  if (message.type === 'thought')
    return { id: message.id, kind: 'thought', name: '', args: message.content, text: message.content }
  let meta: { name: string; arguments: string } = { name: '', arguments: '{}' }
  try { meta = { ...meta, ...JSON.parse(message.metadata ?? '{}') } } catch { /* 使用默认值 */ }
  return { id: message.id, name: meta.name, args: meta.arguments, result: message.content }
}

/** 普通历史消息：用户气泡 / Agent 文本 / 系统提示 / 文件变更 / 检查点 */
function MessageRow({ message, onOpenFilePath, onCodeAction, ...actions }: {
  message: IWorkMessage
  onOpenFilePath?: (path: string) => void
  onCodeAction?: (code: string, action: 'copy' | 'insert') => void
} & MessageActions) {
  if (message.type === 'file_change') {
    let meta: FileChangeMeta = { path: '', action: 'write' }
    try { meta = JSON.parse(message.metadata ?? '{}') } catch { /* 使用默认值 */ }
    return <AgentFileChangeRow path={meta.path} action={meta.action} onOpenPath={onOpenFilePath} />
  }
  if (message.type === 'checkpoint') return <CheckpointRow message={message} />
  if (message.role === 'user') return <UserBubble message={message} actions={actions} />
  return <AgentTextBlock message={message} onCodeAction={onCodeAction} actions={actions} />
}

/** 检查点行：会话内可直接回滚到该快照（与流式时间线共用 AgentCheckpointRow） */
function CheckpointRow({ message }: { message: IWorkMessage }) {
  const confirm = useConfirm()
  let meta: { id?: string; fileCount?: number } = {}
  try { meta = JSON.parse(message.metadata ?? '{}') } catch { /* 使用默认值 */ }
  return (
    <AgentCheckpointRow
      label={message.content}
      fileCount={meta.fileCount}
      onRestore={meta.id ? () => confirm({
        message: `确定回滚到检查点「${message.content}」吗？工作区相关文件将被覆盖。`,
        onConfirm: () => workCheckpointService.restore(meta.id!),
      }) : undefined}
    />
  )
}


function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}






