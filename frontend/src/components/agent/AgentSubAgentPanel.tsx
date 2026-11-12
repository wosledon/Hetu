import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import AgentTimeline from './AgentTimeline'
import type { AgentTimelineItem } from '../../utils/agentTimeline'

const STAGE_META: Record<string, { labelKey: string; cls: string }> = {
  running: { labelKey: 'subagent.running', cls: 'text-sky-600 dark:text-sky-400' },
  done: { labelKey: 'subagent.done', cls: 'text-emerald-600 dark:text-emerald-400' },
  error: { labelKey: 'subagent.error', cls: 'text-rose-600 dark:text-rose-400' },
}

export interface AgentSubAgentPanelProps {
  description: string
  stage: string
  tool?: string
  steps?: number
  message?: string
  /** 内层时间线（思考 / 正文 / 工具调用），已归一为时间线条目 */
  entries?: AgentTimelineItem[]
  /** 编码会话独有：点击路径 / 在终端运行 / 插入代码 */
  onOpenPath?: (path: string) => void
  onRunCommand?: (command: string) => void
  onInsertCode?: (code: string) => void
}

/**
 * 子 Agent 折叠面板：主 Agent 派出的每个子 Agent 在会话里只占这一个工具块——
 * 折叠时只露「子 Agent + 描述 + 状态」，展开后才把它的内层时间线（思考 / 正文 /
 * 工具调用）铺出来。默认折叠：一次子 Agent 有几十步内层过程，摊在会话里会把
 * 主 Agent 自己的输出冲散。运行中的标题带扫光动画，说明它还在跑而不是卡住。
 */
export default function AgentSubAgentPanel({
  description, stage, tool, steps, message, entries, onOpenPath, onRunCommand, onInsertCode,
}: AgentSubAgentPanelProps) {
  const { t } = useTranslation('agent')
  const [open, setOpen] = useState(false)
  const running = stage === 'running' || stage === 'start'
  const meta = STAGE_META[running ? 'running' : stage] ?? STAGE_META.done
  const items = entries ?? []

  return (
    <div className={`overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
      stage === 'error'
        ? 'border-red-200/80 bg-red-50/40 dark:border-red-400/15 dark:bg-red-500/[0.04]'
        : 'border-gray-200/80 bg-white/65 dark:border-white/[0.07] dark:bg-slate-900/35'
    }`}>
      <div onClick={() => setOpen(!open)} className="flex min-h-11 cursor-pointer items-center gap-2 px-2.5 py-2 transition-colors hover:bg-white/55 dark:hover:bg-white/[0.025]">
        <button
          type="button"
          aria-label={open ? t('subagent.collapse') : t('subagent.expand')}
          title={open ? t('subagent.collapse') : t('subagent.expand')}
          onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
          className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          stage === 'error'
            ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300'
            : 'bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300'
        }`}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
        </span>
        <span className="shrink-0 text-xs font-semibold text-gray-700 dark:text-gray-200">{t('subagent.label')}</span>
        <span
          className={`min-w-0 flex-1 truncate text-[11px] ${running ? 'subagent-working-title' : 'text-gray-500 dark:text-gray-400'}`}
          title={description}
        >
          {description}
        </span>
        {running && tool && <span className="shrink-0 font-mono text-[10px] text-gray-400">{tool}</span>}
        {steps != null && steps > 0 && <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{t('subagent.steps', { n: steps })}</span>}
        <span className={`shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium dark:bg-white/[0.05] ${meta.cls}`}>{t(meta.labelKey)}</span>
        {message && <span className="hidden min-w-0 max-w-[32%] truncate text-[10px] text-gray-400 lg:inline" title={message}>{message}</span>}
      </div>
      {open && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-gray-200/70 bg-gray-50/45 p-2 dark:border-white/[0.06] dark:bg-gray-950/25">
          {items.length > 0
            ? (
                <AgentTimeline
                  items={items}
                  streaming={running}
                  onOpenPath={onOpenPath}
                  onRunCommand={onRunCommand}
                  onInsertCode={onInsertCode}
                />
              )
            : (
              <p className="px-1 py-0.5 text-[11px] text-gray-400">
                {running ? t('subagent.waiting') : t('subagent.empty')}
              </p>
            )}
        </div>
      )}
    </div>
  )
}
