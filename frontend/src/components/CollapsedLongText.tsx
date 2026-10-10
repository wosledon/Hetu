import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { isLongText, longTextSummary } from '../utils/longText'

/**
 * 长文本折叠：折叠态只显示行数与字符数，需要看内容时再展开。
 * 粘贴进来又发出去的日志/JSON/base64 往往上百行，直接铺在会话里既挡视线也没人逐行读；
 * 内容始终就是 text 本身，折叠只是渲染层的事（不影响复制、编辑等操作）。
 */
export default function CollapsedLongText({ text, children, className = '' }: { text: string; children: ReactNode; className?: string }) {
  const [expanded, setExpanded] = useState(false)

  if (!isLongText(text)) return <>{children}</>

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title="点击展开查看原文"
        className={`flex w-full items-center gap-2 text-left text-sm opacity-80 transition-opacity hover:opacity-100 ${className}`}
      >
        <FileText size={13} className="shrink-0" />
        <span className="shrink-0 font-medium">已折叠长文本</span>
        <span className="text-xs opacity-80">{longTextSummary(text)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs underline">
          展开 <ChevronDown size={12} />
        </span>
      </button>
    )
  }

  return (
    <div className={className}>
      {children}
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="mt-1.5 flex items-center gap-0.5 text-[11px] opacity-60 transition-opacity hover:opacity-100"
      >
        <ChevronUp size={11} /> 收起
      </button>
    </div>
  )
}
