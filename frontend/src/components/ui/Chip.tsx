import type { ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '../../utils/cn'
import IconButton from './IconButton'

export type ChipTone = 'blue' | 'sky' | 'cyan' | 'amber' | 'violet' | 'emerald' | 'indigo' | 'rose'

/** 引用/附件/筛选标签的底与描边：完整静态类名，Tailwind 才能扫描到 */
const TONES: Record<ChipTone, string> = {
  blue: 'border-blue-200/80 bg-blue-50/80 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300',
  sky: 'border-sky-200/80 bg-sky-50/80 text-sky-700 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-300',
  cyan: 'border-cyan-200/80 bg-cyan-50/80 text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-500/10 dark:text-cyan-300',
  amber: 'border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300',
  violet: 'border-violet-200/80 bg-violet-50/80 text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-300',
  emerald: 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  indigo: 'border-indigo-200/80 bg-indigo-50/80 text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-500/10 dark:text-indigo-300',
  rose: 'border-rose-200/80 bg-rose-50/80 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300',
}

/** 模型不支持该附件时的告警态：统一用 amber 而不是调用方自选 */
const STRUCK = 'border-amber-300/80 bg-amber-50/90 text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-300'

export interface ChipProps {
  tone?: ChipTone
  /** 附件不被当前模型支持：告警图标 + 删除线 */
  struck?: boolean
  icon?: ReactNode
  /** 图片附件缩略图 */
  imageUrl?: string
  title?: string
  /** 传了才渲染移除按钮 */
  onRemove?: () => void
  /** 移除按钮的无障碍名称（onRemove 存在时必传） */
  removeLabel?: string
  className?: string
  children: ReactNode
}

/** 统一的上下文标签：引用、附件、筛选条件共用同一套尺寸/配色/移除行为 */
export default function Chip({
  tone = 'blue',
  struck = false,
  icon,
  imageUrl,
  title,
  onRemove,
  removeLabel = '',
  className,
  children,
}: ChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'flex max-w-[260px] items-center gap-1 rounded-md border px-1 py-0.5 text-[11px] leading-4',
        struck ? STRUCK : TONES[tone],
        className,
      )}
    >
      {struck ? (
        <AlertTriangle size={12} className="shrink-0" />
      ) : imageUrl ? (
        <img src={imageUrl} alt="" draggable={false} className="h-4 w-4 shrink-0 rounded-[3px] object-cover" />
      ) : icon}
      <span className={cn('truncate', struck && 'line-through')}>{children}</span>
      {onRemove && (
        <IconButton size="xs" variant="bare" label={removeLabel} onClick={onRemove}>
          <X size={9} />
        </IconButton>
      )}
    </span>
  )
}