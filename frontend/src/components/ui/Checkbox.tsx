import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type CheckboxTone = 'blue' | 'rose' | 'teal'

const ACCENT: Record<CheckboxTone, string> = {
  blue: 'accent-blue-600',
  rose: 'accent-rose-600',
  teal: 'accent-teal-600',
}

const SIZES = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
} as const

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md'
  tone?: CheckboxTone
}

/** 统一复选框：尺寸、主色、聚焦态只在这里维护（原生 input 仅作为实现细节） */
const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { size = 'sm', tone = 'blue', className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'shrink-0 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30',
        SIZES[size],
        ACCENT[tone],
        className,
      )}
      {...rest}
    />
  )
})

export default Checkbox