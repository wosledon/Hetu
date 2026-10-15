import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import AgentTimeline from './AgentTimeline'
import { subagentEntriesToTimeline, type AgentTimelineItem } from '../../utils/agentTimeline'
import type { SubagentEntry } from '../../utils/agentStream'

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
  /** 内层时间线（思考 / 正文 / 工具调用） */
  entries?: SubagentEntry[]
  /** 编码会话独有：点击路径 / 在终端运行 / 插入代码 */
  onOpenPath?: (path: string) => void
  onRunCommand?: (command: string) => void
  onInsertCode?: (code: string) => void
}

/**
 * 子 Agent 折叠面板：把头部的「子任务 + 状态」折叠条和内部的时间线拼在一起，
 * 让子 Agent 看起来像一段挂载在会话里的独立会话——工作期间默认展开、可随时折叠，
 * 标题在运行中带扫光动画（说明它还在跑，不是卡住）。
 */
export default function AgentSubAgentPanel({
  description, stage, tool, steps, message, entries, onOpenPath, onRunCommand, onInsertCode,
}: AgentSubAgentPanelProps) {
  const { t } = useTranslation('agent')
  const running = stage === 'running' || stage === 'start'
  // 用户手动折叠 / 展开优先；未手动操作时跟随运行状态（跑的时候铺开，跑完自动收起）
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? running
  const toggle = () => setUserOpen(!open)
  const items: AgentTimelineItem[] = subagentEntriesToTimeline(entries)
  const meta = STAGE_META[running ? 'running' : stage] ?? STAGE_META.done

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
      <div onClick={toggle} className="flex cursor-pointer items-center gap-2 px-2 py-1">
        <button
          type="button"
          aria-label={open ? (t('subagent.collapse') as string) : (t('subagent.expand') as string)}
          title={open ? (t('subagent.collapse') as string) : (t('subagent.expand') as string)}
          onClick={(e) => { e.stopPropagation(); toggle() }}
          className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {running
          ? <Loader2 size={11} className="shrink-0 animate-spin text-sky-500" />
          : <Bot size={11} className="shrink-0 text-gray-400" />}
        <span
          className={`min-w-0 flex-1 truncate text-[11px] font-medium ${running ? 'subagent-working-title' : 'text-gray-600 dark:text-gray-300'}`}
          title={description}
        >
          {description}
        </span>
        {tool && !running && <span className="shrink-0 font-mono text-[10px] text-gray-400">{tool}</span>}
        {steps != null && steps > 0 && <span className="shrink-0 text-[10px] text-gray-400">{t('subagent.steps', { n: steps })}</span>}
        <span className={`shrink-0 text-[10px] font-medium ${meta.cls}`}>{t(meta.labelKey)}</span>
        {message && <span className="min-w-0 max-w-[38%] truncate text-[10px] text-gray-400" title={message}>{message}</span>}
      </div>
      {open && (
        <div className="border-t border-gray-100 bg-white px-2 py-1.5 dark:border-gray-800 dark:bg-gray-900">
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
