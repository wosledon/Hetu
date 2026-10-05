import { useState, useEffect, useRef, useCallback } from 'react'
import { TerminalSquare, X, RotateCcw, ChevronDown, ChevronUp, Eraser, Copy, Check, Wifi } from 'lucide-react'
import { workTerminalService, workTerminalUrl } from '../../services/workService'

interface WorkTerminalProps {
  projectId?: string
  onClose: () => void
  height?: number
}

/** 剥离 ANSI 转义序列 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}

export default function WorkTerminal({ projectId, onClose, height }: WorkTerminalProps) {
  const [content, setContent] = useState('')
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [copied, setCopied] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const append = useCallback((text: string) => {
    setContent((prev) => {
      const next = prev + text
      return next.length > 50000 ? next.slice(next.length - 50000) : next
    })
  }, [])

  const connect = useCallback((id: string) => {
    const ws = new WebSocket(workTerminalUrl(id))
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setError('终端连接失败，请检查后端是否运行')
    ws.onmessage = (e) => { setError(''); append(e.data as string) }
    return ws
  }, [append])

  useEffect(() => {
    if (!projectId) return
    const ws = connect(projectId)
    wsRef.current = ws
    return () => {
      // 先摘除旧处理器再关闭，避免关闭事件误置连接状态
      ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null
      ws.close()
      wsRef.current = null
    }
  }, [projectId, connect])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [content])

  useEffect(() => {
    if (connected) inputRef.current?.focus()
  }, [connected])

  const send = (text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const value = text.trim()
    if (value) {
      wsRef.current.send(value + '\r')
      setHistory((prev) => (prev[prev.length - 1] === value ? prev : [...prev, value].slice(-100)))
    }
    setInput('')
    setHistoryIndex(-1)
  }

  const recallHistory = (direction: -1 | 1) => {
    if (history.length === 0) return
    const nextIndex = direction === -1
      ? (historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1))
      : (historyIndex < 0 ? -1 : historyIndex + 1)
    if (nextIndex >= history.length || nextIndex < 0) {
      setHistoryIndex(-1)
      setInput('')
      return
    }
    setHistoryIndex(nextIndex)
    setInput(history[nextIndex])
  }

  const restart = async () => {
    if (!projectId) return
    setContent('')
    setError('')
    const old = wsRef.current
    if (old) {
      old.onopen = null; old.onclose = null; old.onerror = null; old.onmessage = null
      old.close()
      wsRef.current = null
    }
    try {
      await workTerminalService.stop(projectId)
    } catch {
      // 停止失败也继续重连，最坏情况是复用旧进程
    }
    if (wsRef.current) return
    setConnected(false)
    wsRef.current = connect(projectId)
  }

  /** 不断进程重连：用于连接抖动后恢复 */
  const reconnect = () => {
    if (!projectId) return
    const old = wsRef.current
    if (old) {
      old.onopen = null; old.onclose = null; old.onerror = null; old.onmessage = null
      old.close()
      wsRef.current = null
    }
    setConnected(false)
    setError('')
    wsRef.current = connect(projectId)
  }

  const clearScreen = () => setContent('')

  const copyOutput = () => {
    navigator.clipboard.writeText(stripAnsi(content))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setError('复制失败'))
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); send(input); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); recallHistory(-1); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); recallHistory(1); return }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      if (!input.trim() && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('\u0003')
        append('^C\n')
      }
      setInput('')
      setHistoryIndex(-1)
    }
  }

  if (!projectId) return null

  if (collapsed) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-gray-200 bg-gray-100 px-3 dark:border-gray-800 dark:bg-gray-900">
        <TerminalSquare size={13} className="text-gray-500" />
        <span className="text-[11px] text-gray-500">终端</span>
        <button onClick={() => setCollapsed(false)} className="ml-auto rounded p-0.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800">
          <ChevronUp size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-gray-200 bg-[#1e1e1e] dark:border-gray-800" style={{ height: height ?? 208 }}>
      <div className="flex h-8 shrink-0 items-center gap-2 bg-[#252526] px-3 text-gray-300">
        <TerminalSquare size={13} />
        <span className="text-[11px] font-medium">终端</span>
        {connected ? (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 已连接
          </span>
        ) : (
          <span className="text-[10px] text-gray-500">未连接</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={clearScreen} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="清屏" aria-label="清屏">
            <Eraser size={12} />
          </button>
          <button onClick={copyOutput} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="复制输出" aria-label="复制输出">
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
          {!connected && (
            <button onClick={reconnect} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="重新连接" aria-label="重新连接">
              <Wifi size={12} />
            </button>
          )}
          <button onClick={restart} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="重启终端" aria-label="重启终端">
            <RotateCcw size={12} />
          </button>
          <button onClick={() => setCollapsed(true)} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="折叠" aria-label="折叠终端">
            <ChevronDown size={12} />
          </button>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="关闭" aria-label="关闭终端">
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[12px] leading-relaxed text-gray-200">
        {error && <div className="text-red-400">{error}</div>}
        {!error && !content && <div className="text-gray-500">终端已就绪，等待输出...</div>}
        <pre className="whitespace-pre-wrap break-all">{stripAnsi(content)}</pre>
        <div ref={bottomRef} />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-white/10 px-2 py-1">
        <span className="text-[11px] text-emerald-400">❯</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          disabled={!connected}
          placeholder={connected ? '输入命令回车执行（↑↓ 历史，Ctrl+C 中断）' : '连接中...'}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-gray-200 outline-none placeholder:text-gray-500"
        />
      </div>
    </div>
  )
}
