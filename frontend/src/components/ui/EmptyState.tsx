import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  hint?: string
  /** 主操作按钮等 */
  action?: ReactNode
  className?: string
}

/** 统一空态：图标胶囊 + 标题 + 说明 + 可选操作 */
export default function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 py-12 text-center', className)}>
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-100/80 dark:bg-white/[0.05]">
          {icon}
        </div>
      )}
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}