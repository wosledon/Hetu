import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

export interface AgentThoughtBlockProps {
  text: string
  /** 流式进行中：标题带加载指示 */
  streaming?: boolean
}

/**
 * 思考过程折叠块。对话页、编码会话、任务看板详情共用同一外观。
 */
export default function AgentThoughtBlock({ text, streaming = false }: AgentThoughtBlockProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {open ? <ChevronDown size={11} className="shrink-0 text-gray-400" /> : <ChevronRight size={11} className="shrink-0 text-gray-400" />}
        <Brain size={11} className="shrink-0 text-gray-400" />
        <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">思考过程</span>
        {streaming && <Loader2 size={10} className="shrink-0 animate-spin text-gray-400" />}
      </button>
      {open && (
        <p className="border-t border-gray-100 px-2.5 py-1.5 whitespace-pre-wrap text-[11px] italic leading-relaxed text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {text}
        </p>
      )}
    </div>
  )
}
