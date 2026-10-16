import type { HTMLAttributes, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../utils/cn'

/** 树行统一节奏：每层缩进 14px、行基础左距 8px（内联输入行对齐时复用） */
export const TREE_INDENT_PX = 14

type TreeTone = 'blue' | 'emerald'

const SELECTED_BG: Record<TreeTone, string> = {
  blue: 'bg-blue-50 dark:bg-blue-950/40',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/20',
}
const SELECTED_TEXT: Record<TreeTone, string> = {
  blue: 'font-medium text-blue-700 dark:text-blue-200',
  emerald: 'font-medium text-emerald-700 dark:text-emerald-200',
}

export interface TreeRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  /** 层级（0 起），决定缩进 */
  depth?: number
  /** 可展开节点：渲染折叠箭头；不可展开时渲染同宽占位保持图标对齐 */
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  onClick?: () => void
  selected?: boolean
  tone?: TreeTone
  /** sm：文件树等紧凑行 */
  size?: 'sm' | 'md'
  /** 叶子行对齐到父级标签时，在层级缩进外再补一个箭头位 */
  indentExtra?: boolean
  icon?: ReactNode | ((active: boolean) => ReactNode)
  label: ReactNode
  labelClassName?: string
  truncateLabel?: boolean
  /** 标签下方的副标题（如项目描述），单行截断 */
  subtitle?: ReactNode
  /** 标签后的常显内容（计数、徽标、勾选框等） */
  badge?: ReactNode
  /** 行尾悬停才显示的操作按钮组 */
  actions?: ReactNode
}

/** 统一的树形列表行：缩进、折叠箭头、选中态、悬停操作行为全局一致 */
export default function TreeRow({
  depth = 0,
  expandable = false,
  expanded = false,
  onToggle,
  onClick,
  selected = false,
  tone = 'blue',
  size = 'md',
  indentExtra = false,
  icon,
  label,
  labelClassName,
  truncateLabel = true,
  subtitle,
  badge,
  actions,
  className,
  ...rest
}: TreeRowProps) {
  const interactive = Boolean(onClick)
  const chevronSize = size === 'sm' ? 11 : 14
  return (
    <div
      {...rest}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-1.5 transition-colors',
        size === 'sm' ? 'rounded px-1.5 py-[3px]' : 'rounded-lg px-2 py-1.5',
        interactive && 'cursor-pointer',
        selected ? SELECTED_BG[tone] : interactive && 'hover:bg-gray-50 dark:hover:bg-white/[0.04]',
        className,
      )}
      style={{ paddingLeft: 8 + depth * TREE_INDENT_PX + (indentExtra ? TREE_INDENT_PX : 0) }}
    >
      {expandable ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(e) => { e.stopPropagation(); onToggle?.() }}
          className="shrink-0 text-gray-400"
        >
          {expanded ? <ChevronDown size={chevronSize} /> : <ChevronRight size={chevronSize} />}
        </button>
      ) : (
        <span className={cn('shrink-0', size === 'sm' ? 'w-[11px]' : 'w-3.5')} />
      )}
      {typeof icon === 'function' ? icon(selected) : icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn(
          size === 'sm' ? 'text-[12px]' : 'text-[13px]',
          truncateLabel && 'truncate',
          selected ? SELECTED_TEXT[tone] : 'text-gray-700 dark:text-gray-200',
          labelClassName,
        )}
        >
          {label}
        </span>
        {subtitle ? <span className="truncate text-[11px] leading-tight text-gray-400 dark:text-gray-500">{subtitle}</span> : null}
      </span>
      {badge}
      {actions && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  )
}
