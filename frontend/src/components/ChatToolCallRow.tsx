import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Check, Loader2, Play, Terminal, Wrench, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { renderToolName, renderToolResult } from '../utils/toolRendering'

export interface ChatToolCallRowProps {
  name: string
  args: string
  result?: string
  isError?: boolean
  /** 结果未到达即为执行中 */
  running?: boolean
  /** 文本型行（思考 / 节点输出）：只展示一段文本，视觉与工具行保持一致 */
  text?: string
  /** 文本型行的标签，默认「思考」 */
  label?: string
  /** 目标路径可点击时回调（编码会话：在编辑器中打开） */
  onOpenPath?: (path: string) => void
  /** 可运行命令可点击时回调（编码会话：在终端运行） */
  onRunCommand?: (command: string) => void
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
  work_run_command: Terminal,
}

/** 参数摘要指向文件路径的工具：只有这些才允许「在编辑器中打开」 */
const FILE_TARGET_TOOLS = new Set([
  'work_read_file', 'work_write_file', 'work_apply_patch', 'work_delete_file', 'work_move_file',
])

function isFileTarget(name: string): boolean {
  return FILE_TARGET_TOOLS.has(name)
}

/**
 * Copilot 风格的瀑布流行：图标 + 名称 + 目标/命令 + 状态，点击展开详情。
 * 工具调用与文本型条目（思考 / 节点输出）共用同一套外观，保证时间线样式一致。
 */
export default function ChatToolCallRow({ name, args, result, isError, running, text, label, onOpenPath, onRunCommand }: ChatToolCallRowProps) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const isText = text !== undefined
  const Icon = isText ? Brain : (TOOL_ICON[name] ?? Wrench)
  const rowLabel = isText ? (label ?? t('shared.thinking')) : renderToolName(name)
  const summary = isText ? null : summarizeArgs(name, args)
  const done = result !== undefined && !running
  const canRun = !isText && !!onRunCommand && (name === 'run_command' || name === 'work_run_command')

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? t('tool.collapseDetails') : t('tool.expandDetails')}
          className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <Icon size={11} className={`shrink-0 ${isText || name !== 'run_command' ? 'text-gray-400' : 'text-emerald-500'}`} />
        <span className="shrink-0 text-[11px] font-medium text-gray-600 dark:text-gray-300">{rowLabel}</span>
        {summary && (
          onOpenPath && isFileTarget(name) ? (
            <button
              onClick={() => onOpenPath(summary)}
              title={t('tool.openInEditor')}
              className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-gray-400 underline-offset-2 hover:text-blue-500 hover:underline"
            >
              {summary}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-400" title={summary}>{summary}</span>
          )
        )}
        {!summary && <span className="flex-1" />}
        {canRun && (
          <button
            onClick={() => onRunCommand?.(summary ?? '')}
            title={t('tool.runInTerminal')}
            aria-label={t('tool.runInTerminal')}
            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-emerald-500 dark:hover:bg-gray-700"
          >
            <Play size={11} />
          </button>
        )}
        {!isText && (
          running
            ? <Loader2 size={11} className="ml-auto shrink-0 animate-spin text-gray-400" />
            : done
              ? isError
                ? <X size={11} className="ml-auto shrink-0 text-red-500" />
                : <Check size={11} className="ml-auto shrink-0 text-emerald-500" />
              : <Play size={11} className="ml-auto shrink-0 text-gray-300 dark:text-gray-600" />
        )}
      </div>
      {open && (
        <div className="border-t border-gray-100 bg-white px-2.5 py-2 dark:border-gray-800 dark:bg-gray-900">
          {isText ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              {text}
            </pre>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
