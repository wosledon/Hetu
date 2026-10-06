import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Send, Square, ChevronDown, ChevronRight, Loader2,
  ShieldCheck, ShieldOff, CircleHelp, History, PenLine, FilePlus, FileX,
  ListChecks, Coins, User, Copy, Check, Braces, SquareCode, FolderOpen, SquareTerminal, Brain, Wrench, Bot,
  Plus, Download, Stethoscope, X, Play, RotateCcw, FileCode, Quote, PanelRightClose, PanelRightOpen,
} from 'lucide-react'
import { workSessionService, workProjectService, workOpenService, workCheckpointService } from '../../services/workService'
import { aiModelService } from '../../services/aiProviderService'
import { promptPresetService } from '../../services/promptPresetService'
import type { IWorkSession, IWorkMessage, IWorkProject, WorkPermissionMode, IWorkOpenApp } from '../../types/work'
import ThemedMarkdown from '../ThemedMarkdown'
import Select from '../Select'
import { consumeSseStream, SSE_ERROR_PREFIX } from '../../utils/sse'
import { useConfirm } from '../../components/confirm'

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
interface QuestionRequestView { toolCallId: string; data: string }
interface UsageView { promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number; latencyMs: number }

/** 流式执行时间线：工具 / 文件 / 检查点 / 子 Agent 按发生顺序 inline 展示 */
type TimelineItem =
  | { kind: 'tool'; seq: number; id: string; name: string; arguments: string; result?: string }
  | { kind: 'file'; seq: number; path: string; action: string }
  | { kind: 'checkpoint'; seq: number; id: string; label: string; fileCount: number }
  | { kind: 'subagent'; seq: number; id: string; description: string; stage: string; tool?: string; steps?: number; message?: string }

type WorkStreamHandlers = {
  onContent: (text: string) => void
  onThought: (text: string) => void
  onToolCall: (tc: { id: string; name: string; arguments: string }) => void
  onToolResult: (id: string, content: string) => void
  onFileChange: (fc: FileChangeMeta) => void
  onApprovalRequest: (req: ApprovalRequestView) => void
  onQuestion: (req: QuestionRequestView) => void
  onCheckpoint: (cp: { id: string; label: string; fileCount: number }) => void
  onSubAgent: (sa: { id: string; description: string; stage: string; tool?: string; steps?: number; message?: string }) => void
  onUsage: (usage: UsageView) => void
}

/** 把工作流的一帧分发给对应 handler；非 JSON 帧按纯文本追加。 */
function dispatchWorkEvent(data: string, handlers: WorkStreamHandlers): void {
  if (data.startsWith(SSE_ERROR_PREFIX)) {
    handlers.onContent('\n' + data)
    return
  }
  try {
    const evt = JSON.parse(data)
    if (evt.type === 'content' && typeof evt.text === 'string') handlers.onContent(evt.text)
    else if (evt.type === 'thinking' && typeof evt.text === 'string') handlers.onThought(evt.text)
    else if (evt.type === 'tool_call') handlers.onToolCall({ id: evt.id, name: evt.name, arguments: evt.arguments })
    else if (evt.type === 'tool_result') handlers.onToolResult(evt.id, evt.content)
    else if (evt.type === 'file_change') handlers.onFileChange({ path: evt.path, action: evt.action })
    else if (evt.type === 'approval_request') handlers.onApprovalRequest({ id: evt.id, name: evt.name, arguments: evt.arguments })
    else if (evt.type === 'question') handlers.onQuestion({ toolCallId: evt.toolCallId, data: evt.data })
    else if (evt.type === 'checkpoint') handlers.onCheckpoint({ id: evt.id, label: evt.label, fileCount: evt.fileCount })
    else if (evt.type === 'subagent') handlers.onSubAgent({ id: evt.id, description: evt.description, stage: evt.stage, tool: evt.tool, steps: evt.steps, message: evt.message })
    else if (evt.type === 'usage') handlers.onUsage({ promptTokens: evt.promptTokens, completionTokens: evt.completionTokens, cachedTokens: evt.cachedTokens, totalTokens: evt.totalTokens, latencyMs: evt.latencyMs })
  } catch {
    handlers.onContent(data)
  }
}

const PERMISSION_MODES: { value: WorkPermissionMode; label: string }[] = [
  { value: 'plan', label: '计划（只调研）' },
  { value: 'readonly', label: '只读' },
  { value: 'ask', label: '写入需确认' },
  { value: 'auto', label: '自动执行' },
  { value: 'bypass', label: '全部放行' },
]

/** 工具栏统一样式的下拉选择器（复用自定义 Select，展开菜单为统一风格） */
function ToolbarSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      triggerClassName="flex h-[26px] max-w-[140px] shrink-0 items-center justify-between gap-1 rounded-md px-1.5 text-[11px] text-gray-600 outline-none transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50"
    />
  )
}

const PLAN_EXECUTE_PROMPT = '按上面的计划开始执行。'

const FILE_ACTION_META: Record<string, { label: string; cls: string }> = {
  create: { label: '新建', cls: 'text-emerald-600 dark:text-emerald-400' },
  delete: { label: '删除', cls: 'text-rose-600 dark:text-rose-400' },
  write: { label: '修改', cls: 'text-amber-600 dark:text-amber-400' },
}

const TOOL_META: Record<string, { label: string; tone: string }> = {
  work_list_dir: { label: '浏览目录', tone: 'text-sky-500' },
  work_read_file: { label: '读取文件', tone: 'text-sky-500' },
  work_write_file: { label: '修改文件', tone: 'text-amber-500' },
  work_apply_patch: { label: '局部修改', tone: 'text-amber-500' },
  work_delete_file: { label: '删除文件', tone: 'text-rose-500' },
  work_move_file: { label: '移动文件', tone: 'text-amber-500' },
  work_glob: { label: '查找文件', tone: 'text-sky-500' },
  work_grep: { label: '搜索内容', tone: 'text-sky-500' },
  work_git: { label: 'Git 查询', tone: 'text-violet-500' },
  work_run_command: { label: '执行命令', tone: 'text-orange-500' },
  work_diagnostics: { label: '构建诊断', tone: 'text-orange-500' },
  work_semantic_search: { label: '语义搜索', tone: 'text-violet-500' },
  work_task: { label: '子 Agent', tone: 'text-indigo-500' },
  work_skill: { label: '调用技能', tone: 'text-indigo-500' },
}

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
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [thinking, setThinking] = useState('')
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [liveUsage, setLiveUsage] = useState<UsageView | null>(null)
  const [approvals, setApprovals] = useState<ApprovalRequestView[]>([])
  const [questions, setQuestions] = useState<QuestionRequestView[]>([])
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  const [pendingMode, setPendingMode] = useState<{ sessionId: string; value: WorkPermissionMode } | null>(null)
  const [modelOverride, setModelOverride] = useState<{ sessionId: string; value: string } | null>(null)
  const [openFeedback, setOpenFeedback] = useState('')
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

  const { data: aiModels = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  const { data: openApps = [] } = useQuery({
    queryKey: ['workOpenApps'],
    queryFn: () => workOpenService.apps(),
    staleTime: 5 * 60 * 1000,
  })

  // 智能体（提示词预设）与推理强度
  const { data: agents = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
    staleTime: 5 * 60 * 1000,
  })
  const [agentOverride, setAgentOverride] = useState<{ sessionId: string; value: string } | null>(null)
  const [effortOverride, setEffortOverride] = useState<{ sessionId: string; value: string } | null>(null)
  const selectedAgentId = session && agentOverride?.sessionId === session.id ? agentOverride.value : ''
  const reasoningEffort = session && effortOverride?.sessionId === session.id ? effortOverride.value : ''

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

  /** 粘贴绝对路径 → 转为引用 chip（不放回输入框） */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
  const [historyIndex, setHistoryIndex] = useState(-1)

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
      : session?.permissionMode ?? 'ask'

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, timeline, approvals, questions])

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
 // 刚发出且后端尚未在历史中持久化的消息 → 派生展示（持久化后自动让位）
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user'),
    [messages],
  )
  const showPendingUser =
    pendingUser !== null && lastUserMessage?.content !== pendingUser

  const resetStreamState = () => {
    setStreamingContent('')
    setThinking('')
    setTimeline([])
    setLiveUsage(null)
    setApprovals([])
    setQuestions([])
    seqRef.current = 0
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-lg shadow-indigo-500/20">
            <Bot size={28} className="text-white" />
          </div>
          <h3 className="text-base font-medium text-gray-800 dark:text-gray-100">Code 模式</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            选择左侧会话开始，或新建会话。编码 Agent 可以读写项目文件、执行开发命令、运行构建诊断，并按权限模式请求确认。
          </p>
          {onTogglePanel && (
            <button
              onClick={onTogglePanel}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[12px] font-medium text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-600"
            >
              <PanelRightOpen size={13} />
              {panelOpen ? '收起工作面板' : '打开工作面板'}
            </button>
          )}
        </div>
      </div>
    )
  }

  const handleSend = async () => {
    if (!session || !input.trim() || isStreaming) return
    const content = input.trim()
    setInput('')
    setHistoryIndex(-1)
    setInputHistory((prev) => [...prev.slice(-49), content])
    setInjectedContexts([])
    await runStream(buildContent(content), permissionMode)
  }

  /** 把上下文 chips 组装进提示词 */
  const buildContent = (raw: string): string => {
    const parts: string[] = []
    if (activeFilePath) parts.push(`【引用文件】${activeFilePath}`)
    for (const c of injectedContexts) {
      if (c.kind === 'selection') parts.push(`【选中代码 · ${c.label}】\n\`\`\`\n${c.text}\n\`\`\``)
    }
    if (parts.length === 0) return raw
    return `${parts.join('\n')}\n\n${raw}`
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

  const runStream = async (content: string, mode: WorkPermissionMode, persistUserMessage = true) => {
    if (!session) return
    setIsStreaming(true)
    if (persistUserMessage) setPendingUser(content)
    resetStreamState()

    const controller = new AbortController()
    streamRef.current = controller
   const handlers: WorkStreamHandlers = {
      onContent: (text) => setStreamingContent((prev) => prev + text),
      onThought: (text) => setThinking((prev) => prev + text),
      onToolCall: (tc) => setTimeline((prev) => {
        const idx = prev.findIndex((x) => x.kind === 'tool' && x.id === tc.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...tc } as TimelineItem
          return next
        }
        return [...prev, { kind: 'tool', seq: seqRef.current++, ...tc } as TimelineItem]
      }),
      onToolResult: (id, result) => setTimeline((prev) =>
        prev.map((x) => (x.kind === 'tool' && x.id === id ? { ...x, result } : x)),
      ),
      onFileChange: (fc) => setTimeline((prev) => {
        const existing = prev.find((x) => x.kind === 'file' && x.path === fc.path)
        if (existing) return prev.map((x) => (x === existing ? { ...x, ...fc } as TimelineItem : x))
        return [...prev, { kind: 'file', seq: seqRef.current++, ...fc } as TimelineItem]
      }),
      onApprovalRequest: (req) => setApprovals((prev) => [...prev.filter((x) => x.id !== req.id), req]),
      onQuestion: (req) => setQuestions((prev) => [...prev.filter((x) => x.toolCallId !== req.toolCallId), req]),
      onCheckpoint: (cp) => setTimeline((prev) => [...prev, { kind: 'checkpoint', seq: seqRef.current++, ...cp } as TimelineItem]),
      onSubAgent: (sa) => setTimeline((prev) => {
        const idx = prev.findIndex((x) => x.kind === 'subagent' && x.id === sa.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...sa } as TimelineItem
          return next
        }
        return [...prev, { kind: 'subagent', seq: seqRef.current++, ...sa } as TimelineItem]
      }),
      onUsage: (usage) => setLiveUsage(usage),
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
      setApprovals([])
      setQuestions([])
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
    setApprovals((prev) => prev.filter((x) => x.id !== id))
    workSessionService.approve(session.id, id, approve).catch(() => {})
  }

  const submitAnswer = (toolCallId: string) => {
    if (!session || !answerDraft.trim()) return
    const answer = answerDraft.trim()
    setAnswerDraft('')
    setQuestions((prev) => prev.filter((x) => x.toolCallId !== toolCallId))
    workSessionService.answer(session.id, toolCallId, answer).catch(() => {})
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

  const modeIcon =
    permissionMode === 'plan'
      ? <ListChecks size={13} className="shrink-0 text-sky-500" />
      : permissionMode === 'readonly' || permissionMode === 'bypass'
        ? <ShieldOff size={13} className="shrink-0 text-amber-500" />
        : <ShieldCheck size={13} className="shrink-0 text-emerald-500" />

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
          {usageTotal.totalTokens > 0 && (
            <span
              className="hidden items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400 sm:flex"
              title={`输入 ${formatTokens(usageTotal.promptTokens)} / 输出 ${formatTokens(usageTotal.completionTokens)}${usageTotal.cachedTokens > 0 ? ` / 缓存命中 ${formatTokens(usageTotal.cachedTokens)}` : ''}${usageTotal.latencyMs > 0 ? ` · 本轮耗时 ${(usageTotal.latencyMs / 1000).toFixed(1)}s` : ''}`}
            >
              <Coins size={10} />
              {formatTokens(usageTotal.totalTokens)}
              {usageTotal.cachedTokens > 0 && <span className="text-gray-400 dark:text-gray-500">缓存 {formatTokens(usageTotal.cachedTokens)}</span>}
            </span>
          )}
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
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
          {olderCount > 0 && (
            <button
              onClick={() => setShowOlder(true)}
              className="mx-auto flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <ChevronDown size={11} />展开更早的 {olderCount} 条消息
            </button>
          )}
          {visibleMessages.map((msg) =>
            isProcessMessage(msg)
              ? <ProcessMessageRow key={msg.id} message={msg} onOpenFilePath={onOpenFilePath} onRunCommand={onRunCommand} />
              : <MessageRow key={msg.id} message={msg} onOpenFilePath={onOpenFilePath} onCodeAction={(code, action) => { if (action === 'insert') onInsertCode?.(code) }} />,
          )}

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

          {/* 本轮流式输出：思考 → 审批/追问 → 执行时间线 → 正文 */}
          {isStreaming && (
            <div className="space-y-2">
              {thinking && <ThoughtBlock text={thinking} streaming={isStreaming} />}

              {approvals.map((req) => (
                <ApprovalCard
                  key={req.id}
                  request={req}
                  onApprove={() => submitApproval(req.id, true)}
                  onDeny={() => submitApproval(req.id, false)}
                />
              ))}

              {questions.length > 0 && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-800/50 dark:bg-indigo-950/20">
                  {questions.map((q) => (
                    <div key={q.toolCallId} className="space-y-2">
                      <div className="flex items-start gap-2">
                        <CircleHelp size={15} className="mt-0.5 shrink-0 text-indigo-500" />
                        <p className="whitespace-pre-wrap text-[13px] text-gray-800 dark:text-gray-100">{questionText(q.data)}</p>
                      </div>
                      <div className="flex items-end gap-2">
                        <textarea
                          value={answerDraft}
                          onChange={(e) => setAnswerDraft(e.target.value)}
                          rows={2}
                          placeholder="输入回答后发送"
                          className="flex-1 resize-none rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-indigo-400 dark:border-indigo-800 dark:bg-gray-900"
                        />
                        <button
                          onClick={() => submitAnswer(q.toolCallId)}
                          disabled={!answerDraft.trim()}
                          className="rounded-lg bg-indigo-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-600 disabled:opacity-40"
                        >
                          回答
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {timeline.map((item) => <TimelineRow key={item.seq} item={item} onOpenFilePath={onOpenFilePath} onRunCommand={onRunCommand} />)}

              {streamingContent && (
                <div className="text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                  <ThemedMarkdown
                    source={streamingContent}
                    onCodeAction={(code, action) => { if (action === 'insert') onInsertCode?.(code) }}
                  />
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-blue-500" aria-hidden />
                </div>
              )}

              {!streamingContent && timeline.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  思考中...
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

      {/* 输入区：上下文 chips + 模式/Agent/模型/推理强度工具栏 */}
      <div className="bg-white p-3 dark:bg-gray-900">
        <div className="mx-auto max-w-3xl">
          {(activeFilePath || injectedContexts.length > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {activeFilePath && (
                <span
                  className="flex max-w-64 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                  title={`引用文件：${activeFilePath}`}
                >
                  <FileCode size={10} className="shrink-0" />
                  <span className="truncate">{activeFilePath}</span>
                  <button
                    onClick={() => onClearActiveFile?.()}
                    aria-label="移除引用文件"
                    className="shrink-0 rounded-full p-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                  >
                    <X size={9} />
                  </button>
                </span>
              )}
              {injectedContexts.map((c) => (
                <span
                  key={c.id}
                  className="flex max-w-64 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  title={c.kind === 'selection' ? c.text.slice(0, 200) : c.text}
                >
                  {c.kind === 'selection' ? <Quote size={10} className="shrink-0" /> : <FileCode size={10} className="shrink-0" />}
                  <span className="truncate">{c.kind === 'selection' ? `选中 ${c.label}` : c.label}</span>
                  <button
                    onClick={() => setInjectedContexts((prev) => prev.filter((x) => x.id !== c.id))}
                    aria-label="移除上下文"
                    className="shrink-0 rounded-full p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                  return
                }
                if (e.key === 'ArrowUp' && (input === '' || e.currentTarget.selectionStart === 0)) {
                  if (inputHistory.length === 0) return
                  e.preventDefault()
                  const next = historyIndex < 0 ? inputHistory.length - 1 : Math.max(0, historyIndex - 1)
                  setHistoryIndex(next)
                  setInput(inputHistory[next])
                  return
                }
                if (e.key === 'ArrowDown' && historyIndex >= 0) {
                  e.preventDefault()
                  const next = historyIndex + 1
                  if (next >= inputHistory.length) { setHistoryIndex(-1); setInput('') }
                  else { setHistoryIndex(next); setInput(inputHistory[next]) }
                }
              }}
              placeholder="描述你要完成的开发任务，如：修复登录页的样式问题（↑ 回溯历史输入）"
              rows={2}
              className="max-h-40 w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-gray-400"
            />
            <div className="flex flex-nowrap items-center gap-1.5 px-1.5 py-1.5">
              {modeIcon}
              <ToolbarSelect
                value={permissionMode}
                onChange={(v) => setPermissionMode(v as WorkPermissionMode)}
                options={PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label }))}
              />
              <ToolbarSelect
                value={selectedAgentId}
                onChange={(v) => session && setAgentOverride({ sessionId: session.id, value: v })}
                options={[{ value: '', label: '默认 Agent' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
              />
              <ToolbarSelect
                value={selectedModelId}
                onChange={(v) => setSelectedModelId(v)}
                options={[{ value: '', label: '默认模型' }, ...aiModels.filter((m) => m.purpose === 'chat').map((m) => ({ value: m.id, label: m.displayName }))]}
              />
              <ToolbarSelect
                value={reasoningEffort}
                onChange={(v) => session && setEffortOverride({ sessionId: session.id, value: v })}
                options={[{ value: '', label: '默认强度' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]}
              />
              <button
                onClick={() => sendPreset(`运行构建诊断${project?.diagnosticsCommand ? `（${project.diagnosticsCommand}）` : ''}，汇总错误与警告并给出修复建议`)}
                disabled={isStreaming}
                title="运行构建诊断并汇报"
                aria-label="运行构建诊断"
                className="flex h-[27px] shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/60"
              >
                <Stethoscope size={12} />诊断
              </button>
              {isStreaming ? (
                <button
                  onClick={() => streamRef.current?.abort()}
                  className="ml-auto flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-lg bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300"
                  title="停止生成"
                  aria-label="停止生成"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="ml-auto flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
                  aria-label="发送"
                >
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 px-1 text-[11px] text-gray-400">
            <span>Enter 发送 · Shift+Enter 换行 · ↑ 历史 · Ctrl+L 聚焦</span>
            <span className="hidden sm:inline">Agent 按权限模式读写项目文件；引用文件 / 选中代码随消息发送</span>
          </p>
        </div>
      </div>
    </div>
  )
}

const OPEN_APP_STORAGE_KEY = 'hetu-work-open-app'

const OPEN_APP_FALLBACK_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  vscode: Braces,
  cursor: SquareCode,
  explorer: FolderOpen,
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

function UserBubble({ message }: { message: IWorkMessage }) {
  return (
    <div className="flex flex-row-reverse gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
        <User size={15} />
      </div>
      <div className="flex min-w-0 max-w-[85%] flex-col items-end">
        <div className="flex items-center gap-2 px-1 pb-0.5">
          <span className="text-[10px] font-medium text-gray-400">我</span>
          <span className="text-[10px] text-gray-300 dark:text-gray-600">{formatTime(message.createdAt)}</span>
        </div>
        <div className="rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-3 text-sm text-white shadow-sm">
          {message.content}
        </div>
      </div>
    </div>
  )
}

function AgentTextBlock({ message, onCodeAction }: { message: IWorkMessage; onCodeAction?: (code: string, action: 'copy' | 'insert') => void }) {
  const [copied, setCopied] = useState(false)
  if (message.type === 'system') {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-gray-100 px-3 py-1 text-[11px] text-gray-400 dark:bg-gray-800/70 dark:text-gray-500">{message.content}</p>
      </div>
    )
  }
  const copy = () => {
    navigator.clipboard.writeText(message.content)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }
  return (
    <div className="group">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium text-gray-400">Agent</span>
        <span className="text-[10px] text-gray-300 dark:text-gray-600">{formatTime(message.createdAt)}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 dark:hover:bg-gray-800"
        >
          {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
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
    </div>
  )
}

function FileChangeRow({ change, onOpenPath }: { change: FileChangeMeta; onOpenPath?: (path: string) => void }) {
  const meta = FILE_ACTION_META[change.action] ?? FILE_ACTION_META.write
  const Icon = change.action === 'delete' ? FileX : change.action === 'create' ? FilePlus : PenLine
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5 dark:border-gray-800 dark:bg-gray-800/40">
      <Icon size={13} className={`shrink-0 ${meta.cls}`} />
      {onOpenPath ? (
        <button
          onClick={() => onOpenPath(change.path)}
          title="在编辑器中打开"
          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-gray-600 underline-offset-2 hover:text-blue-500 hover:underline dark:text-gray-300"
        >
          {change.path}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-600 dark:text-gray-300">{change.path}</span>
      )}
      <span className={`shrink-0 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
    </div>
  )
}

/** 检查点行：对话内可直接回滚到该快照 */
function CheckpointRow({ message }: { message: IWorkMessage }) {
  const confirm = useConfirm()
  const [restoring, setRestoring] = useState(false)
  let meta: { id?: string; fileCount?: number } = {}
  try { meta = JSON.parse(message.metadata ?? '{}') } catch { /* 使用默认值 */ }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-2.5 py-1.5 dark:border-sky-900/40 dark:bg-sky-950/20">
      <History size={12} className="shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-sky-800 dark:text-sky-300">
        检查点 · {message.content}
      </span>
      {meta.id && (
        <button
          onClick={() => confirm({
            message: `确定回滚到检查点「${message.content}」吗？工作区相关文件将被覆盖。`,
            onConfirm: async () => {
              setRestoring(true)
              try {
                await workCheckpointService.restore(meta.id!)
              } finally {
                setRestoring(false)
              }
            },
          })}
          disabled={restoring}
          title="回滚到此检查点"
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-600 transition-colors hover:bg-sky-100 disabled:opacity-40 dark:text-sky-300 dark:hover:bg-sky-900/40"
        >
          {restoring ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          回滚到此
        </button>
      )}
    </div>
  )
}

function ThoughtBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        {open ? <ChevronDown size={11} className="shrink-0 text-gray-400" /> : <ChevronRight size={11} className="shrink-0 text-gray-400" />}
        <Brain size={11} className="shrink-0 text-gray-400" />
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">思考过程</span>
        {streaming && <Loader2 size={10} className="shrink-0 animate-spin text-gray-400" />}
      </button>
      {open && (
        <p className="border-t border-gray-100 px-2.5 py-1.5 whitespace-pre-wrap text-[11px] italic leading-relaxed text-gray-400 dark:border-gray-800">
          {text}
        </p>
      )}
    </div>
  )
}

/** 历史消息中的过程事件（思考 / 工具调用 / 子 Agent）：各自折叠，展开才看细节 */
function ProcessMessageRow({ message, onOpenFilePath, onRunCommand }: {
  message: IWorkMessage
  onOpenFilePath?: (path: string) => void
  onRunCommand?: (command: string) => void
}) {
  if (message.type === 'thought') return <ThoughtBlock text={message.content} streaming={false} />
  if (message.type === 'tool') {
    let meta: { name: string; arguments: string } = { name: '', arguments: '{}' }
    try { meta = { ...meta, ...JSON.parse(message.metadata ?? '{}') } } catch { /* 使用默认值 */ }
    return <ToolCallRow name={meta.name} args={meta.arguments} result={message.content} onOpenPath={onOpenFilePath} onRunCommand={onRunCommand} />
  }
  let meta: { stage: string; tool?: string; steps?: number; message?: string } = { stage: 'done' }
  try { meta = { ...meta, ...JSON.parse(message.metadata ?? '{}') } } catch { /* 使用默认值 */ }
  return <SubAgentRow description={message.content} stage={meta.stage} tool={meta.tool} steps={meta.steps} message={meta.message} />
}

const isProcessMessage = (m: IWorkMessage) => m.type === 'thought' || m.type === 'tool' || m.type === 'subagent'

/** 普通历史消息：用户气泡 / Agent 文本 / 系统提示 / 文件变更 */
function MessageRow({ message, onOpenFilePath, onCodeAction }: { message: IWorkMessage; onOpenFilePath?: (path: string) => void; onCodeAction?: (code: string, action: 'copy' | 'insert') => void }) {
  if (message.type === 'file_change') {
    let meta: FileChangeMeta = { path: '', action: 'write' }
    try { meta = JSON.parse(message.metadata ?? '{}') } catch { /* 使用默认值 */ }
    return <FileChangeRow change={meta} onOpenPath={onOpenFilePath} />
  }
  if (message.type === 'checkpoint') return <CheckpointRow message={message} />
  if (message.role === 'user') return <UserBubble message={message} />
  return <AgentTextBlock message={message} onCodeAction={onCodeAction} />
}

function TimelineRow({ item, onOpenFilePath, onRunCommand }: {
  item: TimelineItem
  onOpenFilePath?: (path: string) => void
  onRunCommand?: (command: string) => void
}) {
  if (item.kind === 'tool') {
    return <ToolCallRow name={item.name} args={item.arguments} result={item.result} running={item.result === undefined} onOpenPath={onOpenFilePath} onRunCommand={onRunCommand} />
  }
  if (item.kind === 'file') return <FileChangeRow change={{ path: item.path, action: item.action }} onOpenPath={onOpenFilePath} />
  if (item.kind === 'checkpoint') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-2.5 py-1.5 dark:border-sky-900/40 dark:bg-sky-950/20">
        <History size={12} className="shrink-0 text-sky-500" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-sky-800 dark:text-sky-300">{item.label}</span>
        <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
          {item.fileCount} 个文件快照
        </span>
      </div>
    )
  }
  return <SubAgentRow description={item.description} stage={item.stage} tool={item.tool} steps={item.steps} message={item.message} />
}

function SubAgentRow({ description, stage, tool, steps, message }: { description: string; stage: string; tool?: string; steps?: number; message?: string }) {
  const stageMeta =
    stage === 'error'
      ? { label: '失败', cls: 'text-rose-500' }
      : stage === 'done'
        ? { label: '完成', cls: 'text-violet-500' }
        : { label: '运行中', cls: 'text-indigo-500' }
  return (
    <div className="rounded-lg bg-indigo-50/50 px-2.5 py-1.5 dark:bg-indigo-950/20">
      <div className="flex items-center gap-2">
        {stage === 'done' || stage === 'error'
          ? <Bot size={12} className={`shrink-0 ${stageMeta.cls}`} />
          : <Loader2 size={12} className={`shrink-0 animate-spin ${stageMeta.cls}`} />}
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-600 dark:text-gray-300">
          子 Agent · {description}
          {tool && ` · ${tool}`}
          {message && ` · ${message}`}
        </span>
        <span className={`shrink-0 text-[10px] font-medium ${stageMeta.cls}`}>
          {stageMeta.label}{steps ? ` · ${steps} 步` : ''}
        </span>
      </div>
    </div>
  )
}

function ToolCallRow({ name, args, result, running, onOpenPath, onRunCommand }: {
  name: string
  args: string
  result?: string
  running?: boolean
  onOpenPath?: (path: string) => void
  onRunCommand?: (command: string) => void
}) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_META[name] ?? { label: name, tone: 'text-gray-500' }
  const target = extractPath(args)
  const command = extractRunnableCommand(name, args)
  let prettyArgs = args
  try { prettyArgs = JSON.stringify(JSON.parse(args), null, 2) } catch { /* 保留原文 */ }
  return (
    <div className="overflow-hidden rounded-lg border border-gray-100 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
          aria-label={open ? '收起详情' : '展开详情'}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <Wrench size={11} className={`shrink-0 ${meta.tone}`} />
        <span className="shrink-0 text-[11px] font-medium text-gray-600 dark:text-gray-300">{meta.label}</span>
        {target ? (
          onOpenPath ? (
            <button
              onClick={() => onOpenPath(target)}
              title="在编辑器中打开"
              className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-gray-400 underline-offset-2 hover:text-blue-500 hover:underline"
            >
              {target}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-400">{target}</span>
          )
        ) : (
          command && <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-400">{command}</span>
        )}
        {command && onRunCommand && (
          <button
            onClick={() => onRunCommand(command)}
            title="在终端运行"
            aria-label="在终端运行"
            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-emerald-500 dark:hover:bg-gray-700"
          >
            <Play size={11} />
          </button>
        )}
        {result !== undefined && !running
          ? <Check size={11} className="ml-auto shrink-0 text-emerald-500" />
          : <Loader2 size={11} className="ml-auto shrink-0 animate-spin text-gray-400" />}
      </div>
      {open && (
        <div className="border-t border-gray-100 bg-white px-2.5 py-2 dark:border-gray-800 dark:bg-gray-900">
          <pre className="overflow-x-auto text-[11px] text-gray-500 dark:text-gray-400">{prettyArgs}</pre>
          {result !== undefined && (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">{result}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function ApprovalCard({ request, onApprove, onDeny }: { request: ApprovalRequestView; onApprove: () => void; onDeny: () => void }) {
  let args = request.arguments
  try { args = JSON.stringify(JSON.parse(request.arguments), null, 2) } catch { /* 保留原文 */ }
  const target = extractPath(request.arguments)
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 dark:border-amber-700/60 dark:bg-amber-950/20">
      <div className="flex items-start gap-2">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-gray-800 dark:text-gray-100">需要确认：{request.name}</p>
          {target && <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">{target}</p>}
        </div>
      </div>
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px] text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">{args}</pre>
      <div className="mt-2 flex gap-2">
        <button onClick={onApprove} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-600">允许</button>
        <button onClick={onDeny} className="rounded-lg bg-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200">拒绝</button>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** ask_question 的 arguments 形如 { "question": "..." }，解析失败时回退原文。 */
function questionText(data: string): string {
  try {
    const parsed = JSON.parse(data) as { question?: string }
    return parsed.question ?? data
  } catch {
    return data
  }
}

function extractPath(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as { path?: string; to?: string; from?: string }
    return parsed.path ?? parsed.to ?? parsed.from ?? null
  } catch {
    return null
  }
}

function extractCommand(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as { command?: string }
    return parsed.command ?? null
  } catch {
    return null
  }
}

function extractArg(argumentsJson: string, key: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, string>
    return parsed[key] ?? null
  } catch {
    return null
  }
}

/** 可送到终端执行的命令行：run_command / diagnostics / git 只读查询 */
function extractRunnableCommand(name: string, argumentsJson: string): string | null {
  if (name === 'work_run_command' || name === 'work_diagnostics') return extractCommand(argumentsJson)
  if (name === 'work_git') {
    const args = extractArg(argumentsJson, 'args')
    return args ? `git ${args}` : null
  }
  return null
}
