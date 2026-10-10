import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { isLongText, longTextSummary } from '../utils/longText'

/**
 * 长文本折叠：折叠态只显示行数与字符数，需要看内容时再展开。
 * 粘贴进来又发出去的日志/JSON/base64 往往上百行，直接铺在会话里既挡视线也没人逐行读；
 * 内容始终就是 text 本身，折叠只是渲染层的事（不影响复制、编辑等操作）。
 */
export default function CollapsedLongText({ text, children, className = '' }: { text: string; children: ReactNode; className?: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  if (!isLongText(text)) return <>{children}</>

  if (!expanded) {
    return (
      <CollapsedCard label={t('ui:collapsedText.folded')} summary={longTextSummary(text)} onExpand={() => setExpanded(true)} className={className} />
    )
  }

  return (
    <div className={className}>
      {children}
      <RollupButton onClick={() => setExpanded(false)} />
    </div>
  )
}

/** 粘贴的长文本块：折叠态只显示行数/字符数，展开后按原文展示（不做 Markdown 渲染） */
export function PastedLongTextBlock({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={className}>
      <CollapsedCard
        label={expanded ? t('ui:collapsedText.pasted') : t('ui:collapsedText.foldedPasted')}
        summary={label}
        expanded={expanded}
        onExpand={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/5 p-2 text-[11px] leading-relaxed dark:bg-white/5">
          {text}
        </pre>
      )}
    </div>
  )
}

function CollapsedCard({ label, summary, onExpand, expanded = false, className = '' }: { label: string; summary: string; onExpand: () => void; expanded?: boolean; className?: string }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onExpand}
      title={expanded ? t('ui:collapsedText.collapseOriginal') : t('ui:collapsedText.expandHint')}
      className={`flex w-full items-center gap-2 text-left text-sm opacity-80 transition-opacity hover:opacity-100 ${className}`}
    >
      <FileText size={13} className="shrink-0" />
      <span className="shrink-0 font-medium">{label}</span>
      <span className="shrink-0 text-xs opacity-80">{summary}</span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs underline">
        {expanded ? t('ui:collapsedText.collapse') : t('ui:collapsedText.expand')} {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </span>
    </button>
  )
}

function RollupButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 flex items-center gap-0.5 text-[11px] opacity-60 transition-opacity hover:opacity-100"
    >
      <ChevronUp size={11} /> {t('ui:collapsedText.collapse')}
    </button>
  )
}
