import { useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TerminalSquare, RotateCcw, Wifi, Trash2, Eraser } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { workTerminalService, workTerminalUrl } from '../../services/workService'
import { useIsDark } from '../../hooks/useIsDark'

interface WorkTerminalProps {
  projectId?: string
  sessionId?: string
  /** 外部注入的命令请求（对话区"在终端运行"），变化即执行 */
  commandRequest?: { command: string; nonce: number } | null
}

/**
 * 真终端：xterm.js + 后端 PTY（ConPTY / script）。
 * 协议：二进制帧发送键盘数据，文本帧发送 JSON 控制（resize）。
 */
export default function WorkTerminal({ projectId, sessionId, commandRequest }: WorkTerminalProps) {
  const { t } = useTranslation('work')
  const isDark = useIsDark()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const lastCommandNonce = useRef(0)

  // fit 需要容器有实际尺寸且渲染器已初始化，否则 xterm 读取 dimensions 会抛错
  const safeFit = useCallback(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit || !containerRef.current) return
    if (containerRef.current.clientHeight < 20 || containerRef.current.clientWidth < 20) return
    try { fit.fit() } catch { /* 首次渲染前 dimensions 未就绪，ResizeObserver 会重试 */ }
  }, [])

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'resize', cols, rows }))
    }
  }, [])

  const connect = useCallback((id: string, term: Terminal) => {
    const cols = Math.max(40, term.cols)
    const rows = Math.max(10, term.rows)
    const ws = new WebSocket(`${workTerminalUrl(id)}?cols=${cols}&rows=${rows}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      term.writeln(`\x1b[32m● ${t('terminal.connected')}\x1b[0m  ${t('terminal.ptyStarting')}`)
      sendResize(term.cols, term.rows)
    }
    ws.onclose = () => term.writeln(`\r\n\x1b[31m● ${t('terminal.closed')}\x1b[0m`)
    ws.onerror = () => term.writeln(`\r\n\x1b[31m● ${t('terminal.connectFailed')}\x1b[0m`)
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') term.write(e.data)
      else term.write(new Uint8Array(e.data as ArrayBuffer))
    }
    return ws
  }, [sendResize, t])

  // 终端初始化 + 主题
  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      convertEol: false,
      scrollback: 5000,
      theme: isDark
        ? { background: '#0c0f1a', foreground: '#e5e7eb', cursor: '#60a5fa' }
        : { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#60a5fa' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    safeFit()
    termRef.current = term
    fitRef.current = fit

    const onDataDisposer = term.onData((data) => {
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })
    const onResizeDisposer = term.onResize(({ cols, rows }) => sendResize(cols, rows))

    const observer = new ResizeObserver(() => safeFit())
    observer.observe(containerRef.current)

    return () => {
      onDataDisposer.dispose()
      onResizeDisposer.dispose()
      observer.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [isDark, sendResize, safeFit])

  // 项目切换重连
  useEffect(() => {
    if (!projectId || !termRef.current || !fitRef.current) return
    const term = termRef.current
    term.clear()
    const ws = connect(projectId, term)
    wsRef.current = ws
    return () => {
      ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null
      ws.close()
      wsRef.current = null
    }
  }, [projectId, connect])

  // 外部命令注入
  useEffect(() => {
    if (!commandRequest || commandRequest.nonce === lastCommandNonce.current) return
    lastCommandNonce.current = commandRequest.nonce
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(new TextEncoder().encode(commandRequest.command + '\r'))
      termRef.current?.focus()
    }
  }, [commandRequest])

  const restart = async () => {
    if (!projectId) return
    const old = wsRef.current
    if (old) {
      old.onopen = null; old.onclose = null; old.onerror = null; old.onmessage = null
      old.close()
      wsRef.current = null
    }
    try { await workTerminalService.stop(projectId) } catch { /* 停止失败也继续重连 */ }
    if (termRef.current && fitRef.current) {
      termRef.current.clear()
      wsRef.current = connect(projectId, termRef.current)
    }
  }

  const clearScreen = () => termRef.current?.clear()

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
        {t('selectProjectFirst')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#1e1e1e] dark:bg-[#0c0f1a]">
      <div className="flex h-8 shrink-0 items-center gap-2 bg-[#252526] px-3 text-gray-300 dark:bg-black/30">
        <TerminalSquare size={13} />
        <span className="text-[11px] font-medium">{t('terminal.title')}</span>
        {sessionId && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400">{t('terminal.boundSession')}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={clearScreen} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title={t('terminal.clear')}>
            <Eraser size={12} />
          </button>
          <button onClick={restart} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title={t('terminal.restart')}>
            <RotateCcw size={12} />
          </button>
          <button onClick={() => { wsRef.current?.close() }} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white" title={t('terminal.disconnect')}>
            <Trash2 size={12} />
          </button>
          <span className="ml-1 flex items-center gap-1 text-[10px] text-emerald-400">
            <Wifi size={10} />
            PTY
          </span>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}
