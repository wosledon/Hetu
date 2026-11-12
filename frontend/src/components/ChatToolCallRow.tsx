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
  const isCommand = name === 'run_command' || name === 'work_run_command'
  const Icon = isText ? Brain : (TOOL_ICON[name] ?? Wrench)
  const rowLabel = isText ? (label ?? t('shared.thinking')) : renderToolName(name)
  const summary = isText
    ? (text.replace(/\s+/g, ' ').trim().slice(0, 160) || null)
    : summarizeArgs(name, args)
  const done = result !== undefined && !running
  const canRun = !isText && !!onRunCommand && isCommand
  const iconTone = isError
    ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300'
    : isText
      ? 'bg-violet-100 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300'
      : isCommand
        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
        : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'

  return (
    <div className={`overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
      isError
        ? 'border-red-200/80 bg-red-50/40 dark:border-red-400/15 dark:bg-red-500/[0.04]'
        : isText
          ? 'border-violet-200/70 bg-violet-50/35 dark:border-violet-400/10 dark:bg-violet-500/[0.045]'
          : 'border-gray-200/80 bg-white/65 dark:border-white/[0.07] dark:bg-slate-900/35'
    }`}>
      {/* 整行可点展开；内联图标用小尺寸按钮（不用 IconButton：它最小 28px，会把行撑到 44px） */}
      <div
        onClick={() => setOpen(!open)}
        className="group flex min-h-11 cursor-pointer items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-white/55 dark:hover:bg-white/[0.025]"
      >
        <button
          type="button"
          aria-label={open ? t('tool.collapseDetails') : t('tool.expandDetails')}
          title={open ? t('tool.collapseDetails') : t('tool.expandDetails')}
          onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
          className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
          <Icon size={13} />
        </span>
        <span className="shrink-0 text-xs font-semibold text-gray-700 dark:text-gray-200">{rowLabel}</span>
        {summary && (
          onOpenPath && isFileTarget(name) ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenPath(summary) }}
              title={t('tool.openInEditor')}
              className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-gray-500 underline-offset-2 hover:text-blue-500 hover:underline dark:text-gray-400"
            >
              {summary}
            </button>
          ) : (
            <span className={`min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-400 ${isText ? '' : 'font-mono'}`} title={summary}>{summary}</span>
          )
        )}
        {!summary && <span className="flex-1" />}
        {canRun && (
          <button
            type="button"
            aria-label={t('tool.runInTerminal')}
            title={t('tool.runInTerminal')}
            onClick={(e) => { e.stopPropagation(); onRunCommand?.(summary ?? '') }}
            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-emerald-500 dark:hover:bg-gray-700"
          >
            <Play size={11} />
          </button>
        )}
        {running ? (
          <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300" title={t('tool.running')}>
            <Loader2 size={11} className="animate-spin" />
          </span>
        ) : !isText && (
          <span className={`ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            done
              ? isError
                ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300'
                : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-400 dark:bg-white/[0.05] dark:text-gray-500'
          }`}>
            {done ? (isError ? <X size={11} /> : <Check size={11} />) : <Play size={10} />}
          </span>
        )}
      </div>
      {open && (
        <div className="border-t border-gray-200/70 bg-white/70 px-3.5 py-3 dark:border-white/[0.06] dark:bg-gray-950/30">
          {isText ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6 text-gray-600 dark:text-gray-300">
              {text}
            </pre>
          ) : (
            <>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50/80 p-2.5 font-mono text-[11px] leading-5 text-gray-600 dark:bg-black/15 dark:text-gray-300">
                {(() => { try { return JSON.stringify(JSON.parse(args), null, 2) } catch { return args } })()}
              </pre>
              {result !== undefined && (
                <pre className={`mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg p-2.5 font-mono text-[11px] leading-5 ${
                  isError
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                    : 'bg-gray-50/80 text-gray-600 dark:bg-black/15 dark:text-gray-300'
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
