import type { ReactNode, RefObject } from 'react'
import { cn } from '../../utils/cn'

/** 骨架列宽的唯一来源：次级栏 256px，列表列 320px（内容列 flex-1） */
export const WORKBENCH_SECONDARY_WIDTH = 'w-64'
export const WORKBENCH_LIST_WIDTH = 'w-80'

export interface WorkbenchColumnProps {
  /** secondary=导航树（w-64）/ list=条目列表（w-80） */
  role?: 'secondary' | 'list'
  title: ReactNode
  icon?: ReactNode
  count?: number | string
  actions?: ReactNode
  /** 标题行下方的搜索/筛选行 */
  toolbar?: ReactNode
  /** 固定在滚动区上方的操作区（如新建按钮） */
  beforeBody?: ReactNode
  footer?: ReactNode
  /** 嵌在外部列容器里：吃满宽度，不画右边框与底色 */
  embedded?: boolean
  className?: string
  bodyClassName?: string
  bodyRef?: RefObject<HTMLDivElement | null>
  onBodyScroll?: () => void
  children: ReactNode
}

/**
 * 工作台骨架列：标题行（图标 / 小标题 / 计数 / 操作）、可选搜索行、固定操作区、滚动主体与页脚。
 * 列宽、列头、分隔线与底色只在这里维护——笔记树、笔记列表、Code 项目列共用同一套骨架。
 */
export default function WorkbenchColumn({
  role = 'secondary',
  title,
  icon,
  count,
  actions,
  toolbar,
  beforeBody,
  footer,
  embedded = false,
  className,
  bodyClassName,
  bodyRef,
  onBodyScroll,
  children,
}: WorkbenchColumnProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 shrink-0 flex-col',
        embedded
          ? 'w-full'
          : cn(
              role === 'secondary' ? WORKBENCH_SECONDARY_WIDTH : WORKBENCH_LIST_WIDTH,
              'border-r border-gray-200/80 bg-white/35 dark:border-white/[0.07] dark:bg-slate-950/20',
            ),
        className,
      )}
    >
      <div className="shrink-0 border-b border-gray-200/80 px-3.5 py-2.5 dark:border-white/[0.07]">
        <div className="flex min-h-6 items-center gap-1.5">
          {icon}
          <h2 className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {title}
          </h2>
          {count !== undefined && (
            <span className="shrink-0 rounded-full bg-gray-100 glass px-1.5 text-[10px] font-medium leading-4 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              {count}
            </span>
          )}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>}
        </div>
        {toolbar && <div className="mt-2">{toolbar}</div>}
      </div>
      {beforeBody}
      <div ref={bodyRef} onScroll={onBodyScroll} className={cn('min-h-0 flex-1 overflow-y-auto p-2', bodyClassName)}>{children}</div>
      {footer}
    </section>
  )
}