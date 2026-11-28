import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ListChecks, Loader2, Wrench, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ChatToolCallRow from './ChatToolCallRow'
import type { ToolCallEntry } from '../utils/toolRendering'
import { TOOL_ICONS } from '../utils/toolIcons'
import { SurfaceButton } from './ui'

interface ToolCallGroupProps {
  items: ToolCallEntry[]
  /** 当前最后一组仍在流式执行 */
  streaming?: boolean
  /** 单个工具调用的渲染方式，默认用会话瀑布流行（Work 页可传入自己的行组件） */
  renderItem?: (item: ToolCallEntry, compact: boolean) => ReactNode
}

/**
 * 每轮思考及其后续工具折叠为一行摘要，展开后按顺序列出每一条。
 * 时间线统一使用紧凑样式：不以思考开头的工具组也保持同一外观。
 */
export default function ToolCallGroup({ items, streaming = false, renderItem }: ToolCallGroupProps) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const leadThought = items[0]?.kind === 'thought'
  const running = streaming || items.some((i) => i.running)
  const failed = items.some((i) => i.isError)
  let latestThought = ''
  for (const item of items) {
    if (item.kind === 'thought') latestThought = item.text ?? ''
  }
  const thoughtSummary = latestThought.slice(0, 512).replace(/\s+/g, ' ').trim().slice(0, 160)
  const GroupIcon = failed ? X : leadThought ? ListChecks : (TOOL_ICONS[items[0]?.name ?? ''] ?? Wrench)
  const summary = running
    ? t('tool.processRunning', { count: items.length })
    : t('tool.processSummary', { count: items.length })

  return (
    <div className="min-w-0 py-0.5">
      <SurfaceButton
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-6 w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.025]"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-400">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${
          failed
            ? 'text-red-500 dark:text-red-400'
            : leadThought
              ? 'text-sky-500 dark:text-sky-400'
              : 'text-gray-400 dark:text-gray-500'
        }`}>
          <GroupIcon size={13} />
        </span>
        <span className="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {summary}
        </span>
        {thoughtSummary
          ? <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400 dark:text-gray-500" title={thoughtSummary}>{thoughtSummary}</span>
          : <span className="flex-1" />}
        {running && (
          <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center text-blue-500 dark:text-blue-400" title={t('tool.running')}>
            <Loader2 size={12} className="animate-spin" />
          </span>
        )}
      </SurfaceButton>
      {open && (
        <div className="ml-2 space-y-0.5 border-l border-gray-200/80 py-1 pl-3 dark:border-white/[0.08]">
          {items.map((item, i) => {
            // 思考与工具一样走可折叠行：展开组时只显示摘要，避免长思考铺满面板
            if (item.kind === 'thought' || item.kind === 'node') {
              return (
                <div key={item.id ?? i}>
                  {renderItem
                    ? renderItem(item, true)
                    : (
                      <ChatToolCallRow
                        name={item.name}
                        args={item.text ?? ''}
                        text={item.text ?? ''}
                        label={item.kind === 'thought' ? t('shared.thinking') : t('tool.nodeLabel', { name: item.name })}
                        compact
                      />
                    )}
                </div>
              )
            }
            return (
              <div key={item.id ?? i}>
                {renderItem
                  ? renderItem(item, true)
                  : (
                    <ChatToolCallRow
                      name={item.name}
                      args={item.args}
                      result={item.result}
                      isError={item.isError}
                      running={item.running}
                      compact
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
