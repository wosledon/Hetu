import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'
import { FOCUS_DARK, FOCUS_LIGHT, type Tone } from './tones'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  tone?: Tone
  /** sm=紧凑（文本 13px）/ md=常规 / lg=亚克力大号（带 glass 材质） */
  size?: 'sm' | 'md' | 'lg'
  /** 亚克力材质；lg 默认开启 */
  glass?: boolean
}

const BASE = 'w-full border bg-gray-50 text-sm outline-none transition-all placeholder:text-gray-400'

const SIZES = {
  sm: 'rounded-lg border-gray-200/80 bg-gray-50/80 px-2.5 py-1.5 text-[13px]',
  md: 'rounded-lg border-gray-200 px-3 py-2 text-sm',
  lg: 'rounded-xl border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm',
} as const

/** 纯色底（弹窗内）暗色：聚焦不再变白 */
const DARK_PLAIN = 'dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-gray-700'
/** 亚克力底暗色 */
const DARK_GLASS = 'dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:bg-transparent'

/** 通用多行输入框，样式与 Input 一致（resize 由调用方按需通过 className 指定） */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { tone = 'blue', size = 'md', glass, className, ...rest },
  ref,
) {
  const useGlass = glass ?? size === 'lg'

  return (
    <textarea
      ref={ref}
      className={cn(
        BASE,
        SIZES[size],
        useGlass && 'glass',
        `focus:ring-2 ${useGlass ? 'focus:bg-white/70' : 'focus:bg-white'} ${FOCUS_LIGHT[tone]} ${FOCUS_DARK[tone]}`,
        useGlass ? DARK_GLASS : DARK_PLAIN,
        className,
      )}
      {...rest}
    />
  )
})

export default Textarea
