import { useState, type ReactNode } from 'react'
import { Brain, ChevronDown, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import ChatToolCallRow from './ChatToolCallRow'
import { renderToolName, type ToolCallEntry } from '../utils/toolRendering'
import { TOOL_ICONS } from '../utils/toolIcons'

interface ToolCallGroupProps {
  items: ToolCallEntry[]
  /** 单个工具调用的渲染方式，默认用会话瀑布流行（Work 页可传入自己的行组件） */
  renderItem?: (item: ToolCallEntry, compact: boolean) => ReactNode
}

const itemLabel = (item: ToolCallEntry, t: TFunction) => {
  if (item.kind === 'thought') return t('shared.thinking')
  if (item.kind === 'node') return t('tool.nodeLabel', { name: item.name })
  return renderToolName(item.name)
}

/**
 * 每轮思考及其后续工具折叠为一行摘要，展开后按顺序列出每一条。
 * 单条过程不需要本组件，直接渲染单行即可。
 */
export default function ToolCallGroup({ items, renderItem }: ToolCallGroupProps) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const compact = items[0]?.kind === 'thought'
  const running = items.some((i) => i.running)
  const failed = items.some((i) => i.isError)
  const thoughtSummary = compact ? (items[0].text ?? '').replace(/\s+/g, ' ').trim() : ''
  const GroupIcon = failed ? X : compact ? Brain : (TOOL_ICONS[items[0]?.name ?? ''] ?? Wrench)

  // 摘要：同类工具调用显示「名称 × N」，混合过程显示「首条 等 N 项」
  const tools = items.filter((i) => !i.kind || i.kind === 'tool')
  const allSameTool = tools.length === items.length
    && items.length > 1
    && tools.every((t) => t.name === tools[0].name)
  const summary = allSameTool
    ? `${renderToolName(tools[0].name)} × ${items.length}`
    : t('tool.summaryMixed', { first: itemLabel(items[0], t), count: items.length })

  return (
    <div className={compact ? 'min-w-0 py-0.5' : `overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
      failed
        ? 'border-red-200/80 bg-red-50/40 dark:border-red-400/15 dark:bg-red-500/[0.04]'
        : 'border-gray-200/80 bg-white/65 dark:border-white/[0.07] dark:bg-slate-900/35'
    }`}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={compact
          ? 'flex min-h-8 w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.025]'
          : 'flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/55 dark:hover:bg-white/[0.025]'}
      >
        {open
          ? <ChevronDown size={12} className="shrink-0 text-gray-400" />
          : <ChevronRight size={12} className="shrink-0 text-gray-400" />}
        <span className={compact
          ? `flex h-4 w-4 shrink-0 items-center justify-center ${failed ? 'text-red-500 dark:text-red-400' : 'text-violet-500 dark:text-violet-400'}`
          : `flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
              failed ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
            }`}>
          <GroupIcon size={13} />
        </span>
        <span className={compact
          ? 'shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400'
          : 'min-w-0 flex-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200'}>
          {summary}
        </span>
        {compact
          ? thoughtSummary
            ? <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400 dark:text-gray-500" title={thoughtSummary}>{thoughtSummary}</span>
            : <span className="flex-1" />
          : <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{items.length}</span>}
        {running && (
          <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center text-blue-500 dark:text-blue-400" title={t('tool.running')}>
            <Loader2 size={12} className="animate-spin" />
          </span>
        )}
      </button>
      {open && (
        <div className={compact
          ? 'ml-2 space-y-0.5 border-l border-gray-200/80 py-1 pl-3 dark:border-white/[0.08]'
          : 'space-y-1.5 border-t border-gray-200/70 bg-gray-50/45 p-2 dark:border-white/[0.06] dark:bg-gray-950/25'}>
          {items.map((item, i) => {
            if (compact && item.kind === 'thought') {
              return (
                <pre key={item.id ?? i} className="whitespace-pre-wrap break-words px-1 py-1 font-sans text-xs leading-5 text-gray-600 dark:text-gray-300">
                  {item.text}
                </pre>
              )
            }
            if (item.kind === 'thought' || item.kind === 'node') {
              return (
                <div key={item.id ?? i}>
                  {renderItem
                    ? renderItem(item, compact)
                    : (
                      <ChatToolCallRow
                        name={item.name}
                        args={item.text ?? ''}
                        text={item.text ?? ''}
                        label={item.kind === 'thought' ? t('shared.thinking') : t('tool.nodeLabel', { name: item.name })}
                        compact={compact}
                      />
                    )}
                </div>
              )
            }
            return (
              <div key={item.id ?? i}>
                {renderItem
                  ? renderItem(item, compact)
                  : (
                    <ChatToolCallRow
                      name={item.name}
                      args={item.args}
                      result={item.result}
                      isError={item.isError}
                      running={item.running}
                      compact={compact}
                    />
                  )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
