import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../utils/cn'
import { GHOST, LINK, OUTLINE, SOFT, SOLID, type Tone } from './tones'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'outline' | 'danger' | 'link'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  tone?: Tone
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** 胶囊形（rounded-full），用于顶部工具栏一类的圆角按钮 */
  pill?: boolean
  /** secondary 暗色底：page=页面底（默认），modal=深色弹窗内的浅一档底 */
  surface?: 'page' | 'modal'
  /** 主按钮投影 */
  shadow?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  block?: boolean
}

const SIZES = {
  xs: 'gap-1 px-2 py-1 text-xs',
  sm: 'gap-1.5 px-3 py-1.5 text-xs',
  md: 'gap-1.5 px-4 py-2 text-sm',
  lg: 'gap-1.5 px-3.5 py-2 text-[13px]',
} as const

const SECONDARY_PAGE =
  'border border-gray-200 bg-white glass text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
const SECONDARY_MODAL =
  'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'

/**
 * 通用按钮，覆盖项目里的全部标准按钮形态：
 * primary=实色主按钮 / secondary=描边次按钮 / ghost=无底文字按钮（tone 控制悬停色）/
 * soft=浅色底 tone 按钮 / outline=描边 tone 按钮 / danger=红色危险按钮 / link=文字链接。
 * tone 对 primary / ghost / soft / outline / link 生效；size 与 pill 控制尺寸与圆角。
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', tone = 'blue', size = 'md', pill = false, surface = 'page', shadow = false, icon, iconRight, block = false, className, children, type = 'button', ...rest },
  ref,
) {
  const variantCls =
    variant === 'primary'
      ? cn(SOLID[tone], 'text-white')
      : variant === 'secondary'
        ? surface === 'modal'
          ? SECONDARY_MODAL
          : SECONDARY_PAGE
        : variant === 'ghost'
          ? GHOST[tone]
          : variant === 'soft'
            ? SOFT[tone]
            : variant === 'outline'
              ? OUTLINE[tone]
              : variant === 'danger'
                ? 'bg-red-500 text-white hover:bg-red-600'
                : LINK[tone]
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        pill ? 'rounded-full' : 'rounded-lg',
        SIZES[size],
        variantCls,
        shadow && 'shadow-sm',
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  )
})

export default Button
