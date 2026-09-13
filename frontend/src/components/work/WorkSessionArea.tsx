import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, Square, FileCode, GitBranch, ChevronDown, ChevronRight, Loader2, Wrench, FolderTree, ShieldCheck, ShieldOff, CircleHelp, History, PenLine, FilePlus, FileX, ListChecks, Coins, Search } from 'lucide-react'
import { workSessionService } from '../../services/workService'
import { aiModelService } from '../../services/aiProviderService'
import type { IWorkSession, IWorkMessage, IWorkProject, WorkPermissionMode } from '../../types/work'
import ThemedMarkdown from '../ThemedMarkdown'
import Select from '../Select'
import { consumeSseStream, SSE_ERROR_PREFIX } from '../../utils/sse'

interface WorkSessionAreaProps {
  project?: IWorkProject
  session?: IWorkSession
  onSessionUpdated?: (session: IWorkSession) => void
}

interface FileChangeMeta { path: string; action: string }
interface ToolCallView { id: string; name: string; arguments: string; result?: string; hidden?: boolean }
interface ApprovalRequestView { id: string; name: string; arguments: string }
interface QuestionRequestView { toolCallId: string; data: string }
interface CheckpointView { id: string; label: string; fileCount: number }
interface SubAgentView { id: string; description: string; stage: string; tool?: string; steps?: number; message?: string }
interface UsageView { promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number; latencyMs: number }

type WorkStreamHandlers = {
  onContent: (text: string) => void
  onToolCall: (tc: ToolCallView) => void
  onToolResult: (id: string, content: string) => void
  onFileChange: (fc: FileChangeMeta) => void
  onApprovalRequest: (req: ApprovalRequestView) => void
  onQuestion: (req: QuestionRequestView) => void
  onCheckpoint: (cp: CheckpointView) => void
  onSubAgent: (sa: SubAgentView) => void
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
    else if (evt.type === 'thinking' && typeof evt.text === 'string') handlers.onContent(evt.text)
    else if (evt.type === 'tool_call') handlers.onToolCall({ id: evt.id, name: evt.name, arguments: evt.arguments, hidden: evt.hidden })
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
  { value: 'plan', label: '计划模式（只调研）' },
  { value: 'readonly', label: '只读（不改文件）' },
  { value: 'ask', label: '每次写入需确认' },
  { value: 'auto', label: '自动执行写操作' },
  { value: 'bypass', label: '全部放行' },
]

const PLAN_EXECUTE_PROMPT = '按上面的计划开始执行。'

export default function WorkSessionArea({ project, session, onSessionUpdated }: WorkSessionAreaProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [liveToolCalls, setLiveToolCalls] = useState<ToolCallView[]>([])
  const [liveFileChanges, setLiveFileChanges] = useState<FileChangeMeta[]>([])
  const [liveCheckpoints, setLiveCheckpoints] = useState<CheckpointView[]>([])
  const [liveSubAgents, setLiveSubAgents] = useState<SubAgentView[]>([])
  const [liveUsage, setLiveUsage] = useState<UsageView | null>(null)
  const [approvals, setApprovals] = useState<ApprovalRequestView[]>([])
  const [questions, setQuestions] = useState<QuestionRequestView[]>([])
  const [answerDraft, setAnswerDraft] = useState('')
  const [pendingMode, setPendingMode] = useState<{ sessionId: string; value: WorkPermissionMode } | null>(null)
  const [modelOverride, setModelOverride] = useState<{ sessionId: string; value: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streamRef = useRef<AbortController | null>(null)

  const { data: messages = [] } = useQuery({
    queryKey: ['workMessages', session?.id],
    queryFn: () => (session ? workSessionService.getMessages(session.id) : Promise.resolve([])),
    enabled: !!session,
  })

  const { data: aiModels = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })

  const addMessage = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      workSessionService.addMessage(id, { role: 'user', content }),
    onSuccess: (msg) => {
      queryClient.invalidateQueries({ queryKey: ['workMessages', session?.id] })
      queryClient.invalidateQueries({ queryKey: ['workSessions'] })
      if (msg && onSessionUpdated) {
        workSessionService.getById(msg.sessionId).then((s) => onSessionUpdated(s)).catch(() => {})
      }
    },
  })

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
  }, [messages, streamingContent, liveToolCalls, approvals, questions])

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-lg shadow-indigo-500/20">
            <Bot size={28} className="text-white" />
          </div>
          <p className="text-sm text-gray-400">选择一个工作会话开始，或新建会话</p>
        </div>
      </div>
    )
  }

  const handleSend = async () => {
    if (!session || !input.trim() || isStreaming) return
    const content = input.trim()
    setInput('')
    await runStream(content, permissionMode)
  }

  /** 计划模式：切到执行模式并把计划交给 Agent 落地 */
  const executePlan = async () => {
    if (!session || isStreaming) return
    setPermissionMode('auto')
    await runStream(PLAN_EXECUTE_PROMPT, 'auto')
  }

  const runStream = async (content: string, mode: WorkPermissionMode) => {
    if (!session) return
    addMessage.mutate({ id: session.id, content })
    setIsStreaming(true)
    setStreamingContent('')
    setLiveToolCalls([])
    setLiveFileChanges([])
    setLiveCheckpoints([])
    setLiveSubAgents([])
    setLiveUsage(null)
    setApprovals([])
    setQuestions([])

    const controller = new AbortController()
    streamRef.current = controller
    const handlers: WorkStreamHandlers = {
      onContent: (text) => setStreamingContent((prev) => prev + text),
      onToolCall: (tc) => setLiveToolCalls((prev) => [...prev.filter((x) => x.id !== tc.id), tc]),
      onToolResult: (id, result) => setLiveToolCalls((prev) => prev.map((x) => (x.id === id ? { ...x, result } : x))),
      onFileChange: (fc) => setLiveFileChanges((prev) => [...prev.filter((x) => x.path !== fc.path), fc]),
      onApprovalRequest: (req) => setApprovals((prev) => [...prev.filter((x) => x.id !== req.id), req]),
      onQuestion: (req) => setQuestions((prev) => [...prev.filter((x) => x.toolCallId !== req.toolCallId), req]),
      onCheckpoint: (cp) => setLiveCheckpoints((prev) => [...prev.filter((x) => x.id !== cp.id), cp]),
      onSubAgent: (sa) =>
        setLiveSubAgents((prev) =>
          prev.some((x) => x.id === sa.id)
            ? prev.map((x) => (x.id === sa.id ? { ...x, ...sa } : x))
            : [...prev, sa],
        ),
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
      setLiveToolCalls([])
      setLiveFileChanges([])
      setLiveCheckpoints([])
      setLiveSubAgents([])
      setApprovals([])
      setQuestions([])
      queryClient.invalidateQueries({ queryKey: ['workMessages', session.id] })
      queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      queryClient.invalidateQueries({ queryKey: ['workFileChanges', session.id] })
      queryClient.invalidateQueries({ queryKey: ['workCheckpoints', session.id] })
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

  const visibleToolCalls = liveToolCalls.filter((t) => !t.hidden)

  const usageTotal: UsageView = liveUsage ?? {
    promptTokens: session.promptTokens ?? 0,
    completionTokens: session.completionTokens ?? 0,
    cachedTokens: session.cachedTokens ?? 0,
    totalTokens: session.totalTokens ?? 0,
    latencyMs: 0,
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{session.title || '新会话'}</h2>
          <p className="truncate text-[11px] text-gray-400">
            {project ? `${project.name} · ` : ''}{messages.length} 条消息
            {usageTotal.totalTokens > 0 && ` · ${formatTokens(usageTotal.totalTokens)} tokens`}
            {usageTotal.totalTokens > 0 && usageTotal.cachedTokens > 0 && `（缓存 ${formatTokens(usageTotal.cachedTokens)}）`}
            {session.turnCount > 0 && ` · ${session.turnCount} 轮`}
          </p>
        </div>
        <div className="flex w-40 shrink-0 items-center gap-1.5">
          {permissionMode === 'plan'
            ? <ListChecks size={14} className="shrink-0 text-sky-500" />
            : permissionMode === 'readonly' || permissionMode === 'bypass'
              ? <ShieldOff size={14} className="shrink-0 text-amber-500" />
              : <ShieldCheck size={14} className="shrink-0 text-emerald-500" />}
          <Select
            value={permissionMode}
            onChange={(v) => setPermissionMode(v as WorkPermissionMode)}
            options={PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label }))}
          />
        </div>
        <div className="w-44 shrink-0">
          <Select
            value={selectedModelId}
            onChange={(v) => setSelectedModelId(v)}
            options={[
              { value: '', label: '默认模型' },
              ...aiModels.filter((m) => m.purpose === 'chat').map((m) => ({ value: m.id, label: m.displayName })),
            ]}
          />
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
          {messages.filter((m) => m.type === 'text' || m.type === 'system').map((msg) => (
            <WorkMessageView key={msg.id} message={msg} />
          ))}

          {/* 文件变更事件（历史） */}
          {messages.filter((m) => m.type === 'file_change').map((msg) => {
            let meta: FileChangeMeta = { path: '', action: 'write' }
            try { meta = JSON.parse(msg.metadata ?? '{}') } catch { /* ignore */ }
            return <FileChangeCard key={msg.id} change={meta} />
          })}

          {/* 流式内容 */}
          {isStreaming && streamingContent && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                <Bot size={15} />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                <ThemedMarkdown source={streamingContent} />
              </div>
            </div>
          )}

          {/* 实时文件变更 */}
          {liveFileChanges.length > 0 && (
            <div className="space-y-1.5">
              {liveFileChanges.map((fc, i) => <FileChangeCard key={i} change={fc} />)}
            </div>
          )}

          {/* 实时检查点 */}
          {liveCheckpoints.length > 0 && (
            <div className="space-y-1.5">
              {liveCheckpoints.map((cp) => <CheckpointCard key={cp.id} cp={cp} />)}
            </div>
          )}

          {/* 实时工具调用 / 子 Agent */}
          {visibleToolCalls.length > 0 && (
            <div className="space-y-1.5">
              {visibleToolCalls.map((tc) => <ToolCallCard key={tc.id} tc={tc} />)}
            </div>
          )}

          {/* 实时子 Agent */}
          {liveSubAgents.length > 0 && (
            <div className="space-y-1.5">
              {liveSubAgents.map((sa) => <SubAgentCard key={sa.id} sa={sa} />)}
            </div>
          )}

          {/* 计划模式：一键转执行 */}
          {permissionMode === 'plan' && !isStreaming && (
            <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 dark:border-sky-800/50 dark:bg-sky-950/20">
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

          {/* 待确认的写操作 */}
          {approvals.map((req) => (
            <ApprovalCard
              key={req.id}
              request={req}
              onApprove={() => submitApproval(req.id, true)}
              onDeny={() => submitApproval(req.id, false)}
            />
          ))}

          {/* Agent 追问 */}
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

          {/* 流式进行中 */}
          {isStreaming && !streamingContent && (
            <div className="flex items-center gap-2 pl-11 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              思考中...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入区 */}
      <div className="border-t border-gray-200 p-3 dark:border-gray-800">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800">
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
              placeholder="描述你要完成的工作任务，如：修复登录页的样式问题"
              rows={2}
              className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-gray-400"
            />
            {isStreaming ? (
              <button
                onClick={() => streamRef.current?.abort()}
                className="rounded-lg bg-gray-200 p-2 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300"
                title="停止生成"
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="rounded-lg bg-blue-500 p-2 text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
              >
                <Send size={15} />
              </button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-gray-400">Enter 发送 · Shift+Enter 换行 · 编码 Agent 可读写项目文件、执行开发命令</p>
        </div>
      </div>
    </div>
  )
}

function WorkMessageView({ message }: { message: IWorkMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${isUser ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
        {isUser ? <span className="text-xs font-bold">U</span> : <Bot size={15} />}
      </div>
      <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-3 text-sm ${isUser ? 'rounded-tr-sm bg-blue-50 text-gray-900 dark:bg-blue-950/40 dark:text-gray-100' : 'rounded-tl-sm bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'}`}>
        {message.type === 'system' ? (
          <span className="whitespace-pre-wrap text-[13px] text-gray-500">{message.content}</span>
        ) : (
          <ThemedMarkdown source={message.content} />
        )}
        {!isUser && (message.totalTokens ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-1 border-t border-black/5 pt-1.5 text-[10px] text-gray-400 dark:border-white/5">
            <Coins size={10} />
            <span>
              {formatTokens(message.totalTokens ?? 0)} tokens
              {message.cachedTokens ? `（缓存 ${formatTokens(message.cachedTokens)}）` : ''}
              {message.latencyMs ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function FileChangeCard({ change }: { change: FileChangeMeta }) {
  const meta = change.action === 'delete'
    ? { label: '已删除', icon: <FileX size={14} className="shrink-0 text-rose-500" />, box: 'border-rose-200/70 bg-rose-50/70 dark:border-rose-800/40 dark:bg-rose-950/20', text: 'text-rose-800 dark:text-rose-300' }
    : change.action === 'create'
      ? { label: '新建', icon: <FilePlus size={14} className="shrink-0 text-emerald-500" />, box: 'border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-800/40 dark:bg-emerald-950/20', text: 'text-emerald-800 dark:text-emerald-300' }
      : { label: '已修改', icon: <PenLine size={14} className="shrink-0 text-amber-500" />, box: 'border-amber-200/70 bg-amber-50/70 dark:border-amber-800/40 dark:bg-amber-950/20', text: 'text-amber-800 dark:text-amber-300' }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${meta.box}`}>
      {meta.icon}
      <span className={`min-w-0 flex-1 truncate font-mono text-[12px] ${meta.text}`}>{change.path}</span>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.text}`}>{meta.label}</span>
    </div>
  )
}

function CheckpointCard({ cp }: { cp: CheckpointView }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-200/70 bg-sky-50/70 px-3 py-1.5 dark:border-sky-800/40 dark:bg-sky-950/20">
      <History size={14} className="shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-sky-800 dark:text-sky-300">{cp.label}</span>
      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
        {cp.fileCount} 个文件快照
      </span>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function SubAgentCard({ sa }: { sa: SubAgentView }) {
  const meta = sa.stage === 'error'
    ? { label: '子 Agent 失败', box: 'border-rose-200/70 bg-rose-50/70 dark:border-rose-800/40 dark:bg-rose-950/20', text: 'text-rose-800 dark:text-rose-300' }
    : sa.stage === 'done'
      ? { label: '子 Agent 完成', box: 'border-violet-200/70 bg-violet-50/70 dark:border-violet-800/40 dark:bg-violet-950/20', text: 'text-violet-800 dark:text-violet-300' }
      : { label: '子 Agent 运行中', box: 'border-indigo-200/70 bg-indigo-50/70 dark:border-indigo-800/40 dark:bg-indigo-950/20', text: 'text-indigo-800 dark:text-indigo-300' }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${meta.box}`}>
      {sa.stage === 'done' || sa.stage === 'error'
        ? <Bot size={14} className={`shrink-0 ${meta.text}`} />
        : <Loader2 size={14} className={`shrink-0 animate-spin ${meta.text}`} />}
      <span className={`min-w-0 flex-1 truncate text-[12px] ${meta.text}`}>
        {sa.description}{sa.tool && ` · ${sa.tool}`}
        {sa.message && ` · ${sa.message}`}
      </span>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.text}`}>
        {meta.label}{sa.steps ? ` · ${sa.steps} 步` : ''}
      </span>
    </div>
  )
}

function ApprovalCard({ request, onApprove, onDeny }: { request: ApprovalRequestView; onApprove: () => void; onDeny: () => void }) {
  let args = request.arguments
  try { args = JSON.stringify(JSON.parse(request.arguments), null, 2) } catch { /* keep raw */ }
  const target = extractPath(request.arguments)

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 dark:border-amber-700/60 dark:bg-amber-950/20">
      <div className="flex items-start gap-2">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-gray-800 dark:text-gray-100">
            需要确认：{request.name}
          </p>
          {target && <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">{target}</p>}
        </div>
      </div>
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px] text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">{args}</pre>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onApprove}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-600"
        >
          允许
        </button>
        <button
          onClick={onDeny}
          className="rounded-lg bg-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
        >
          拒绝
        </button>
      </div>
    </div>
  )
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

function ToolCallCard({ tc }: { tc: ToolCallView }) {
  const [open, setOpen] = useState(false)
  const nameMap: Record<string, { label: string; icon: React.ReactNode }> = {
    work_list_dir: { label: '浏览目录', icon: <FolderTree size={12} /> },
    work_read_file: { label: '读取文件', icon: <FileCode size={12} /> },
    work_write_file: { label: '修改文件', icon: <Wrench size={12} /> },
    work_apply_patch: { label: '局部修改', icon: <PenLine size={12} /> },
    work_delete_file: { label: '删除文件', icon: <FileX size={12} /> },
    work_move_file: { label: '移动文件', icon: <FileCode size={12} /> },
    work_glob: { label: '查找文件', icon: <FolderTree size={12} /> },
    work_grep: { label: '搜索内容', icon: <FileCode size={12} /> },
    work_git: { label: 'Git 查询', icon: <GitBranch size={12} /> },
    work_run_command: { label: '执行命令', icon: <GitBranch size={12} /> },
    work_diagnostics: { label: '构建诊断', icon: <Wrench size={12} /> },
    work_semantic_search: { label: '语义搜索', icon: <Search size={12} /> },
    work_task: { label: '子 Agent', icon: <Bot size={12} /> },
    work_skill: { label: '调用技能', icon: <Wrench size={12} /> },
  }
  const meta = nameMap[tc.name] ?? { label: tc.name, icon: <Wrench size={12} /> }
  let args = tc.arguments
  try { args = JSON.stringify(JSON.parse(tc.arguments), null, 2) } catch { /* keep raw */ }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 bg-gray-50 px-3 py-1.5 text-left dark:bg-gray-800/50"
      >
        {open ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
        <span className="text-indigo-500">{meta.icon}</span>
        <span className="flex-1 text-[12px] font-medium text-gray-700 dark:text-gray-200">{meta.label}</span>
        {tc.result !== undefined && (
          <span className="text-[10px] text-gray-400">完成</span>
        )}
      </button>
      {open && (
        <div className="border-t border-gray-100 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
          <pre className="overflow-x-auto text-[11px] text-gray-500 dark:text-gray-400">{args}</pre>
          {tc.result !== undefined && (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">{tc.result}</pre>
          )}
        </div>
      )}
    </div>
  )
}
