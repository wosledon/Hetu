import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import ChatToolCallRow from './ChatToolCallRow'
import { renderToolName, type ToolCallEntry } from '../utils/toolRendering'

interface ToolCallGroupProps {
  items: ToolCallEntry[]
  /** 单个工具调用的渲染方式，默认用会话瀑布流行（Work 页可传入自己的行组件） */
  renderItem?: (item: ToolCallEntry, index: number) => ReactNode
}

const itemLabel = (item: ToolCallEntry) => {
  if (item.kind === 'thought') return '思考'
  if (item.kind === 'node') return `节点 · ${item.name}`
  return renderToolName(item.name)
}

/**
 * 两段输出之间的所有过程（工具调用、思考等）折叠为一行摘要，
 * 展开后按顺序列出每一条。单条过程不需要本组件，直接渲染单行即可。
 */
export default function ToolCallGroup({ items, renderItem }: ToolCallGroupProps) {
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
    : `${itemLabel(items[0])} 等 ${items.length} 项`

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-700/40"
      >
        {open
          ? <ChevronDown size={11} className="shrink-0 text-gray-400" />
          : <ChevronRight size={11} className="shrink-0 text-gray-400" />}
        <Wrench size={11} className="shrink-0 text-gray-400" />
        <span className="shrink-0 text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {summary}
        </span>
        <span className="flex-1" />
        {running ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-gray-400" />
        ) : failed ? (
          <X size={11} className="shrink-0 text-red-500" />
        ) : (
          <Check size={11} className="shrink-0 text-emerald-500" />
        )}
      </button>
      {open && (
        <div className="space-y-1 border-t border-gray-100 bg-white p-1.5 dark:border-gray-800 dark:bg-gray-900">
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
                        label={item.kind === 'thought' ? '思考' : `节点 · ${item.name}`}
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
