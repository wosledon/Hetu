import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'
import { SOFT, SOLID, type Tone } from './tones'

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger' | 'success' | 'soft' | 'bare'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称，必填 */
  label: string
  variant?: IconButtonVariant
  tone?: Tone
  size?: 'xs' | 'tiny' | 'sm' | 'md' | 'lg'
  /** 持续选中态（置顶 / 收藏 / 激活的开关）：用 tone 着色，直到取消 */
  active?: boolean
}

const SIZES = {
  xs: 'h-4 w-4 rounded-md',
  tiny: 'h-6 w-6 rounded-md',
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-9 w-9',
} as const

const GHOST =
  'text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
const SECONDARY =
  'border border-gray-200 bg-white glass text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200'
const DANGER =
  'text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400'
const SUCCESS =
  'text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20 dark:hover:text-green-400'
const BARE = 'text-current opacity-60 transition-opacity hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10'

/** 持续选中态的文字色（完整静态类名） */
const ACTIVE_TEXT: Record<Tone, string> = {
  blue: 'text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300',
  indigo: 'text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300',
  violet: 'text-violet-500 hover:text-violet-600 dark:text-violet-400 dark:hover:text-violet-300',
  emerald: 'text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300',
  green: 'text-green-500 hover:text-green-600 dark:text-green-400 dark:hover:text-green-300',
  teal: 'text-teal-500 hover:text-teal-600 dark:text-teal-400 dark:hover:text-teal-300',
  cyan: 'text-cyan-500 hover:text-cyan-600 dark:text-cyan-400 dark:hover:text-cyan-300',
  sky: 'text-sky-500 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300',
  amber: 'text-amber-400 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300',
  rose: 'text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300',
  red: 'text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300',
  gray: 'text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300',
}

/** 图标按钮（纯图标、无文字）。tone 对 primary / soft / active 生效。 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', tone = 'blue', size = 'md', active = false, className, children, type = 'button', ...rest },
  ref,
) {
  const variantCls =
    variant === 'primary' ? cn(SOLID[tone], 'text-white')
      : variant === 'soft' ? SOFT[tone]
        : variant === 'secondary' ? SECONDARY
          : variant === 'danger' ? DANGER
            : variant === 'success' ? SUCCESS
              : variant === 'bare' ? BARE
                : GHOST

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        SIZES[size],
        variantCls,
        active && ACTIVE_TEXT[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

export default IconButton
