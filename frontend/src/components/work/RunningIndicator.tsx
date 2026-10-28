import { useTranslation } from 'react-i18next'

export interface RunningIndicatorProps {
  /** 带文字的药丸徽标（会话头部用）；false 只画带动画的状态点（侧栏行首用） */
  withLabel?: boolean
  className?: string
}

/**
 * 「正在进行」的统一标识：外圈 ping 光环 + 实心点，比静态小圆点更容易注意到。
 * 侧栏项目行 / 会话行行首（只画点，前置）与会话头部（带文字）共用同一套视觉。
 */
export default function RunningIndicator({ withLabel = false, className }: RunningIndicatorProps) {
  const { t } = useTranslation('work')
  const dot = (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  )
  if (!withLabel) return dot
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300 ${className ?? ''}`}
      title={t('common:running')}
    >
      {dot}
      {t('common:running')}
    </span>
  )
}
