import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type SurfaceVariant = 'bare' | 'row' | 'card' | 'plain'

const BASE = 'relative transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30'

const VARIANTS: Record<SurfaceVariant, string> = {
  /** 原样保留调用方外观（迁移存量按钮用），只补按钮语义与聚焦环 */
  bare: '',
  row: 'block w-full rounded-xl border px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50',
  card: 'w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50',
  plain: 'rounded-md',
}

const IDLE: Record<SurfaceVariant, string> = {
  bare: '',
  row: 'border-transparent hover:bg-gray-50/80 dark:hover:bg-white/[0.04]',
  card: 'border-gray-200/70 bg-white/60 hover:border-gray-300 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-white/[0.15]',
  plain: 'hover:bg-gray-50 dark:hover:bg-white/[0.05]',
}

const SELECTED: Record<SurfaceVariant, string> = {
  bare: '',
  row: 'border-blue-100/80 bg-blue-50/70 dark:border-blue-400/10 dark:bg-blue-500/[0.08]',
  card: 'border-blue-300/70 bg-blue-50/60 dark:border-blue-400/30 dark:bg-blue-500/[0.08]',
  plain: 'bg-blue-50 dark:bg-blue-500/10',
}

export interface SurfaceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** row=列表行 / card=可选卡片 / plain=网格单元等裸表面 */
  variant?: SurfaceVariant
  selected?: boolean
}

/**
 * 通用可点击表面：列表行、选项卡片、栅格单元等「非标准按钮外观」的交互面，
 * 统一承载按钮语义、聚焦环、禁用态与选中态；外观只在 variant 表里维护。
 */
const SurfaceButton = forwardRef<HTMLButtonElement, SurfaceButtonProps>(function SurfaceButton(
  { variant = 'bare', selected = false, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected || undefined}
      className={cn(BASE, VARIANTS[variant], selected ? SELECTED[variant] : IDLE[variant], className)}
      {...rest}
    >
      {children}
    </button>
  )
})

export default SurfaceButton