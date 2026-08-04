import { useState, useEffect, useRef } from 'react'
import { TerminalSquare, X, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { workTerminalUrl } from '../../services/workService'

interface WorkTerminalProps {
  projectId?: string
  onClose: () => void
}

export default function WorkTerminal({ projectId, onClose }: WorkTerminalProps) {
  const [lines, setLines] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectId) return
    setLines([])
    setInput('')
    setConnected(false)

    const ws = new WebSocket(workTerminalUrl(projectId))
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)
    ws.onmessage = (e) => {
      setLines((prev) => {
        const next = [...prev, e.data as string]
        if (next.length > 2000) return next.slice(next.length - 2000)
        return next
      })
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  useEffect(() => {
    if (connected) inputRef.current?.focus()
  }, [connected])

  const send = () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(input + '\r')
    setInput('')
  }

  const restart = () => {
    if (!projectId) return
    fetch(`/api/work-terminal/${projectId}/stop`, { method: 'POST' }).then(() => {
      wsRef.current?.close()
      setLines([])
      setConnected(false)
      const ws = new WebSocket(workTerminalUrl(projectId))
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => setConnected(false)
      ws.onmessage = (e) => setLines((prev) => [...prev.slice(-1999), e.data as string])
    })
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
    <div className="flex h-52 shrink-0 flex-col border-t border-gray-200 bg-[#1e1e1e] dark:border-gray-800">
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
          <button onClick={restart} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="重启终端">
            <RotateCcw size={12} />
          </button>
          <button onClick={() => setCollapsed(true)} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="折叠">
            <ChevronDown size={12} />
          </button>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title="关闭">
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[12px] leading-relaxed text-gray-200">
        {lines.length === 0 && <div className="text-gray-500">终端已就绪，等待输出...</div>}
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-white/10 px-2 py-1">
        <span className="text-[11px] text-emerald-400">❯</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          disabled={!connected}
          placeholder={connected ? '输入命令回车执行' : '连接中...'}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-gray-200 outline-none placeholder:text-gray-500"
        />
      </div>
    </div>
  )
}
