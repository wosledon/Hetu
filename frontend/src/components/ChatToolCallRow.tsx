import { useState } from 'react'
import { ChevronDown, ChevronRight, Check, Loader2, Play, Terminal, Wrench, X } from 'lucide-react'
import { renderToolName, renderToolResult } from '../utils/toolRendering'

export interface ChatToolCallRowProps {
  name: string
  args: string
  result?: string
  isError?: boolean
  /** 结果未到达即为执行中 */
  running?: boolean
}

/** 从工具参数里提取最有信息量的摘要（路径 / 命令 / 查询） */
function summarizeArgs(name: string, args: string): string | null {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = parsed[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return null
    }
    if (name === 'run_command') return pick('command', 'cmd')
    return pick('path', 'filePath', 'file', 'query', 'keyword', 'url', 'noteId', 'command')
  } catch {
    return args && args !== '{}' ? args : null
  }
}

const TOOL_ICON: Record<string, typeof Wrench> = {
  run_command: Terminal,
}

/**
 * Copilot 风格的瀑布流工具行：图标 + 工具名 + 目标/命令 + 状态，点击展开参数与结果。
 * 用于流式过程与历史回放（历史数据来自助手消息持久化的 ToolCallsJson）。
 */
export default function ChatToolCallRow({ name, args, result, isError, running }: ChatToolCallRowProps) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICON[name] ?? Wrench
  const summary = summarizeArgs(name, args)
  const done = result !== undefined && !running

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? '收起详情' : '展开详情'}
          className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <Icon size={11} className={`shrink-0 ${name === 'run_command' ? 'text-emerald-500' : 'text-gray-400'}`} />
        <span className="shrink-0 text-[11px] font-medium text-gray-600 dark:text-gray-300">{renderToolName(name)}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-400" title={summary}>{summary}</span>
        )}
        {!summary && <span className="flex-1" />}
        {running
          ? <Loader2 size={11} className="ml-auto shrink-0 animate-spin text-gray-400" />
          : done
            ? isError
              ? <X size={11} className="ml-auto shrink-0 text-red-500" />
              : <Check size={11} className="ml-auto shrink-0 text-emerald-500" />
            : <Play size={11} className="ml-auto shrink-0 text-gray-300 dark:text-gray-600" />}
      </div>
      {open && (
        <div className="border-t border-gray-100 bg-white px-2.5 py-2 dark:border-gray-800 dark:bg-gray-900">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-gray-500 dark:text-gray-400">
            {(() => { try { return JSON.stringify(JSON.parse(args), null, 2) } catch { return args } })()}
          </pre>
          {result !== undefined && (
            <pre className={`mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded p-2 text-[11px] ${
              isError
                ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}>
              {renderToolResult(name, result, isError)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
