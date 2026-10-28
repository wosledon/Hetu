import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface RunningIndicatorProps {
  /** 带文字的药丸徽标（会话头部用）；默认只给旋转图标，用于替换侧栏行首图标 */
  withLabel?: boolean
  /** 图标尺寸：会话行 13 / 项目行彩色方块内 11 */
  size?: number
  className?: string
}

/**
 * 「正在进行」的统一标识。
 * 侧栏项目行 / 会话行在运行中直接用它替换行首图标——比在小图标旁加个点明显得多；
 * 会话头部用带文字的「运行中」药丸。
 */
export default function RunningIndicator({ withLabel = false, size = 13, className }: RunningIndicatorProps) {
  const { t } = useTranslation('work')
  const label = t('common:running')
  if (withLabel) {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300 ${className ?? ''}`}
        title={label}
      >
        <Loader2 size={11} className="shrink-0 animate-spin" aria-hidden />
        {label}
      </span>
    )
  }
  return <Loader2 size={size} className={`shrink-0 animate-spin text-emerald-500 ${className ?? ''}`} aria-label={label} />
}
