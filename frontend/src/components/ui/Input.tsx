import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../utils/cn'
import { FOCUS_DARK, FOCUS_LIGHT, type Tone } from './tones'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  tone?: Tone
  /** sm=紧凑（文本 13px）/ md=常规 / lg=亚克力大号（带 glass 材质） */
  size?: 'sm' | 'md' | 'lg'
  /** 亚克力材质；lg 默认开启 */
  glass?: boolean
  /** 胶囊形（rounded-full） */
  pill?: boolean
  /** 左侧图标（自动补左内边距） */
  icon?: ReactNode
  /** 右侧元素（自动补右内边距） */
  iconRight?: ReactNode
}

const BASE = 'w-full border bg-gray-50 text-sm outline-none transition-all placeholder:text-gray-400'

const SIZES = {
  sm: 'rounded-lg border-gray-200/80 bg-gray-50/80 px-2.5 py-1.5 text-[13px]',
  md: 'rounded-lg border-gray-200 px-3 py-2 text-sm',
  lg: 'rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm',
} as const

const PILL_SIZES = {
  sm: 'rounded-full px-3 py-1 text-[11px]',
  md: 'rounded-full px-3.5 py-2 text-[13px]',
  lg: 'rounded-full px-4 py-2.5 text-sm',
} as const

/** 纯色底（弹窗内）暗色：聚焦不再变白，保持与失焦一致的深色 */
const DARK_PLAIN = 'dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-gray-700'
/** 亚克力底暗色 */
const DARK_GLASS = 'dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:bg-transparent'

const ICON_PAD = { sm: 'pl-8', md: 'pl-9', lg: 'pl-10' } as const
const ICON_RIGHT_PAD = { sm: 'pr-8', md: 'pr-9', lg: 'pr-10' } as const

/**
 * 通用输入框。亮色聚焦统一 `focus:border-{tone}-400 + ring`，
 * 暗色聚焦不再刷白（历史上的暗色输入框 bug 根因就是 focus:bg-white 没有暗色对应项）。
 */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { tone = 'blue', size = 'md', glass, pill = false, icon, iconRight, className, ...rest },
  ref,
) {
  const useGlass = glass ?? size === 'lg'
  const field = (
    <input
      ref={ref}
      className={cn(
        BASE,
        pill ? PILL_SIZES[size] : SIZES[size],
        useGlass && 'glass',
        `focus:ring-2 ${useGlass ? 'focus:bg-white/70' : 'focus:bg-white'} ${FOCUS_LIGHT[tone]} ${FOCUS_DARK[tone]}`,
        useGlass ? DARK_GLASS : DARK_PLAIN,
        icon && ICON_PAD[size],
        iconRight && ICON_RIGHT_PAD[size],
        className,
      )}
      {...rest}
    />
  )

  if (!icon && !iconRight) return field

  return (
    <div className="relative w-full">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          {icon}
        </span>
      )}
      {field}
      {iconRight && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{iconRight}</span>
      )}
    </div>
  )
})

export default Input
