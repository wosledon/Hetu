import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 内边距：sm=p-3 / md=p-5（默认）/ lg=p-6 */
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

/** 通用卡片面板：统一「圆角 + 描边 + 亚克力材质」的表面样式 */
const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padded = 'md', interactive = false, plain = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border border-transparent',
        !plain && 'bg-white dark:bg-gray-900 glass glass-soft',
        padded && PADDING[padded],
        interactive &&
          'transition-all duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:shadow-md dark:hover:border-white/10',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
})

export default Card
