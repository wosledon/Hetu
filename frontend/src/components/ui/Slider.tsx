import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type SliderTone = 'teal' | 'blue'

const ACCENT: Record<SliderTone, string> = {
  teal: 'accent-teal-500',
  blue: 'accent-blue-600',
}

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  tone?: SliderTone
}

/** 统一步进滑块（range）：轨道主色与光标样式集中维护 */
const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { tone = 'teal', className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="range"
      className={cn('w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50', ACCENT[tone], className)}
      {...rest}
    />
  )
})

export default Slider