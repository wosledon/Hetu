import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'
import { SOFT, SOLID, type Tone } from './tones'

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger' | 'soft'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称，必填 */
  label: string
  variant?: IconButtonVariant
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
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

/** 图标按钮（纯图标、无文字）。tone 对 primary / soft 生效 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', tone = 'blue', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  const variantCls =
    variant === 'primary' ? cn(SOLID[tone], 'text-white') : variant === 'soft' ? SOFT[tone] : variant === 'secondary' ? SECONDARY : variant === 'danger' ? DANGER : GHOST

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        SIZES[size],
        variantCls,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

export default IconButton
