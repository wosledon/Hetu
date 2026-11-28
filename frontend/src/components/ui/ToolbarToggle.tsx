import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../utils/cn'

export type ToolbarToggleTone = 'indigo' | 'emerald' | 'amber' | 'blue'

/** 激活态底 + 文字色：完整静态类名，Tailwind 才能扫描到 */
const ACTIVE: Record<ToolbarToggleTone, string> = {
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
}

const IDLE = 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700/50 dark:hover:text-gray-300'

export interface ToolbarToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' | 'aria-label'> {
  /** 无障碍名称，同时作为悬停提示 */
  label: string
  active?: boolean
  tone?: ToolbarToggleTone
  children: ReactNode
}

/**
 * 输入框「额头」/ 工具栏的快速开关：命中尺寸、激活配色、悬停底色统一维护。
 * 各端差异只通过 tone 与图标表达，不再在调用处手写开关按钮的类名。
 */
const ToolbarToggle = forwardRef<HTMLButtonElement, ToolbarToggleProps>(function ToolbarToggle(
  { label, active = false, tone = 'indigo', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
        active ? ACTIVE[tone] : IDLE,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

export default ToolbarToggle