import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../utils/cn'

export interface PageContainerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** centered：滚动外壳 + 内容居中限宽（管理类页面）；fill：撑满父级，内部自组织（工作台类页面） */
  variant?: 'centered' | 'fill'
  children: ReactNode
}

/**
 * 全站仅有的两种页面布局，样式唯一定义点：
 * - centered：`flex-1 overflow-y-auto` 外壳 + `mx-auto max-w-6xl px-8 py-8` 内容区
 * - fill：撑满 AppLayout 的 mainContent 行向容器（`min-h-0 min-w-0 flex-1`，高度由父级 stretch），
 *   方向/溢出/居中等页面差异经 className 覆盖（如 `flex-col`、`overflow-hidden`）
 */
export default function PageContainer({ variant = 'centered', className, children, ...rest }: PageContainerProps) {
  if (variant === 'fill') {
    return (
      <div {...rest} className={cn('flex min-h-0 min-w-0 flex-1', className)}>
        {children}
      </div>
    )
  }
  return (
    <div {...rest} className={cn('flex-1 overflow-y-auto bg-transparent', className)}>
      <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
    </div>
  )
}
