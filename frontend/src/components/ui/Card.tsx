import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** panel=页面级卡片（rounded-2xl + 亚克力）/ tile=条目卡片（rounded-xl，浅底） */
  variant?: 'panel' | 'tile'
  /** 内边距：sm=p-3 / md=p-5（panel 默认）/ lg=p-6（tile 默认 sm） */
  padded?: false | 'sm' | 'md' | 'lg'
  /** 悬停浮起（卡片列表用） */
  interactive?: boolean
  /** 无材质：嵌进外层面板时只做布局，不再叠一层亚克力（否则侧栏里会出现半高嵌套卡片） */
  plain?: boolean
}

const PADDING = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
} as const

/** 统一卡片表面：面板与条目卡片只有圆角/底色差异，描边与悬停行为共用一套 */
const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'panel', padded, interactive = false, plain = false, className, children, ...rest },
  ref,
) {
  const padding = padded ?? (variant === 'tile' ? 'sm' : 'md')
  return (
    <div
      ref={ref}
      className={cn(
        'border',
        variant === 'tile' ? 'rounded-xl' : 'rounded-2xl',
        plain
          ? 'border-transparent'
          : variant === 'tile'
            ? 'border-gray-200/70 bg-white/60 dark:border-white/[0.07] dark:bg-white/[0.03]'
            : 'border-gray-200/70 bg-white/70 glass glass-soft dark:border-white/[0.07] dark:bg-slate-900/35',
        padding && PADDING[padding],
        interactive &&
          'transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-enter)] hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-sm dark:hover:border-white/15',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
})

export default Card
