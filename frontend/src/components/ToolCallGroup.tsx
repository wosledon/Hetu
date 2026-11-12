import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import ChatToolCallRow from './ChatToolCallRow'
import { renderToolName, type ToolCallEntry } from '../utils/toolRendering'

interface ToolCallGroupProps {
  items: ToolCallEntry[]
  /** 单个工具调用的渲染方式，默认用会话瀑布流行（Work 页可传入自己的行组件） */
  renderItem?: (item: ToolCallEntry, index: number) => ReactNode
}

const itemLabel = (item: ToolCallEntry, t: TFunction) => {
  if (item.kind === 'thought') return t('shared.thinking')
  if (item.kind === 'node') return t('tool.nodeLabel', { name: item.name })
  return renderToolName(item.name)
}

/**
 * 两段输出之间的所有过程（工具调用、思考等）折叠为一行摘要，
 * 展开后按顺序列出每一条。单条过程不需要本组件，直接渲染单行即可。
 */
export default function ToolCallGroup({ items, renderItem }: ToolCallGroupProps) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const running = items.some((i) => i.running)
  const failed = items.some((i) => i.isError)

  // 摘要：同类工具调用显示「名称 × N」，混合过程显示「首条 等 N 项」
  const tools = items.filter((i) => !i.kind || i.kind === 'tool')
  const allSameTool = tools.length === items.length
    && items.length > 1
    && tools.every((t) => t.name === tools[0].name)
  const summary = allSameTool
    ? `${renderToolName(tools[0].name)} × ${items.length}`
    : t('tool.summaryMixed', { first: itemLabel(items[0], t), count: items.length })

  return (
    <div className={`overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
      failed
        ? 'border-red-200/80 bg-red-50/40 dark:border-red-400/15 dark:bg-red-500/[0.04]'
        : 'border-gray-200/80 bg-white/65 dark:border-white/[0.07] dark:bg-slate-900/35'
    }`}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/55 dark:hover:bg-white/[0.025]"
      >
        {open
          ? <ChevronDown size={12} className="shrink-0 text-gray-400" />
          : <ChevronRight size={12} className="shrink-0 text-gray-400" />}
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          failed ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
        }`}>
          <Wrench size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
          {summary}
        </span>
        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{items.length}</span>
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          running
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
            : failed
              ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-300'
              : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
        }`}>
          {running ? <Loader2 size={11} className="animate-spin" /> : failed ? <X size={11} /> : <Check size={11} />}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-gray-200/70 bg-gray-50/45 p-2 dark:border-white/[0.06] dark:bg-gray-950/25">
          {items.map((item, i) => {
            if (item.kind === 'thought' || item.kind === 'node') {
              return (
                <div key={item.id ?? i}>
                  {renderItem
                    ? renderItem(item, i)
                    : (
                      <ChatToolCallRow
                        name={item.name}
                        args={item.text ?? ''}
                        text={item.text ?? ''}
                        label={item.kind === 'thought' ? t('shared.thinking') : t('tool.nodeLabel', { name: item.name })}
                      />
                    )}
                </div>
              )
            }
            return (
              <div key={item.id ?? i}>
                {renderItem
                  ? renderItem(item, i)
                  : (
                    <ChatToolCallRow
                      name={item.name}
                      args={item.args}
                      result={item.result}
                      isError={item.isError}
                      running={item.running}
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
