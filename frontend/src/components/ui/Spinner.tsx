import { Loader2 } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface SpinnerProps {
  size?: number
  /** 可访问名称；不传则视为纯装饰（aria-hidden） */
  label?: string
  className?: string
}

/** 统一加载指示：尺寸与颜色只在这里维护 */
export default function Spinner({ size = 14, label, className }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn('shrink-0 animate-spin text-gray-400 dark:text-gray-500', className)}
    />
  )
}