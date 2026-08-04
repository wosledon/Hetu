import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, Square, FileCode, GitBranch, ChevronDown, ChevronRight, Loader2, Wrench, FolderTree } from 'lucide-react'
import { workSessionService } from '../../services/workService'
import { aiModelService } from '../../services/aiProviderService'
import type { IWorkSession, IWorkMessage, IWorkProject } from '../../types/work'
import ThemedMarkdown from '../ThemedMarkdown'
import Select from '../Select'

interface WorkSessionAreaProps {
  project?: IWorkProject
  session?: IWorkSession
  onSessionUpdated?: (session: IWorkSession) => void
}

interface FileChangeMeta { path: string; action: string }
interface ToolCallView { id: string; name: string; arguments: string; result?: string; hidden?: boolean }

async function consumeWorkStream(
  _sessionId: string,
  startRequest: (signal: AbortSignal) => Promise<Response>,
  handlers: {
    onContent: (text: string) => void
    onToolCall: (tc: ToolCallView) => void
    onToolResult: (id: string, content: string) => void
    onFileChange: (fc: FileChangeMeta) => void
  },
) {
  const controller = new AbortController()
  let cancelled = false
  try {
    const response = await startRequest(controller.signal)
    if (!response.body) return
    const reader = response.body.getReader()
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
            handlers.onContent('\n' + data)
            continue
          }
          try {
            const evt = JSON.parse(data)
            if (evt.type === 'content' && typeof evt.text === 'string') handlers.onContent(evt.text)
            else if (evt.type === 'thinking' && typeof evt.text === 'string') handlers.onContent(evt.text)
            else if (evt.type === 'tool_call') handlers.onToolCall({ id: evt.id, name: evt.name, arguments: evt.arguments, hidden: evt.hidden })
            else if (evt.type === 'tool_result') handlers.onToolResult(evt.id, evt.content)
            else if (evt.type === 'file_change') handlers.onFileChange({ path: evt.path, action: evt.action })
          } catch {
            handlers.onContent(data)
          }
        }
      }
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
      reader.releaseLock()
    }
  } catch (error) {
    if (!cancelled && !controller.signal.aborted) {
      console.error('Work stream error:', error)
      handlers.onContent('\n流式输出失败，请检查模型配置。')
    }
  } finally {
    // 标记结束（由外层 await 后刷新消息）
  }
}

export default function WorkSessionArea({ project, session, onSessionUpdated }: WorkSessionAreaProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [liveToolCalls, setLiveToolCalls] = useState<ToolCallView[]>([])
  const [liveFileChanges, setLiveFileChanges] = useState<FileChangeMeta[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>(() => session?.modelId ?? '')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  useEffect(() => {
    setSelectedModelId(session?.modelId ?? '')
  }, [session?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, liveToolCalls])

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
    addMessage.mutate({ id: session.id, content })
    setIsStreaming(true)
    setStreamingContent('')
    setLiveToolCalls([])
    setLiveFileChanges([])

    try {
      await consumeWorkStream(
        session.id,
        (signal) =>
          fetch(`/api/work-sessions/${session.id}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({
              content,
              modelId: selectedModelId || undefined,
              enableTools: true,
              toolApprovalMode: 'auto',
            }),
            signal,
          }),
        {
          onContent: (text) => setStreamingContent((prev) => prev + text),
          onToolCall: (tc) => setLiveToolCalls((prev) => [...prev.filter((x) => x.id !== tc.id), tc]),
          onToolResult: (id, result) => setLiveToolCalls((prev) => prev.map((x) => (x.id === id ? { ...x, result } : x))),
          onFileChange: (fc) => setLiveFileChanges((prev) => [...prev.filter((x) => x.path !== fc.path), fc]),
        },
      )
    } finally {
      setIsStreaming(false)
      setLiveToolCalls([])
      setLiveFileChanges([])
      queryClient.invalidateQueries({ queryKey: ['workMessages', session.id] })
      queryClient.invalidateQueries({ queryKey: ['workSessions', session.projectId] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      queryClient.invalidateQueries({ queryKey: ['workFileChanges', session.id] })
    }
  }

  const visibleToolCalls = liveToolCalls.filter((t) => !t.hidden)

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{session.title || '新会话'}</h2>
          <p className="truncate text-[11px] text-gray-400">
            {project ? `${project.name} · ` : ''}{messages.length} 条消息
          </p>
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

          {/* 实时工具调用 / 子 Agent */}
          {visibleToolCalls.length > 0 && (
            <div className="space-y-1.5">
              {visibleToolCalls.map((tc) => <ToolCallCard key={tc.id} tc={tc} />)}
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
                onClick={() => {
                  const ac = new AbortController()
                  fetch(`/api/work-sessions/${session.id}/stream`, { method: 'POST', signal: ac.signal })
                  ac.abort()
                  setIsStreaming(false)
                }}
                className="rounded-lg bg-gray-200 p-2 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300"
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
      </div>
    </div>
  )
}

function FileChangeCard({ change }: { change: FileChangeMeta }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-1.5 dark:border-amber-800/40 dark:bg-amber-950/20">
      <FileCode size={14} className="shrink-0 text-amber-500" />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-amber-800 dark:text-amber-300">{change.path}</span>
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
        {change.action === 'write' ? '已修改' : '变更'}
      </span>
    </div>
  )
}

function ToolCallCard({ tc }: { tc: ToolCallView }) {
  const [open, setOpen] = useState(false)
  const nameMap: Record<string, { label: string; icon: React.ReactNode }> = {
    work_list_dir: { label: '浏览目录', icon: <FolderTree size={12} /> },
    work_read_file: { label: '读取文件', icon: <FileCode size={12} /> },
    work_write_file: { label: '修改文件', icon: <Wrench size={12} /> },
    work_run_command: { label: '执行命令', icon: <GitBranch size={12} /> },
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
