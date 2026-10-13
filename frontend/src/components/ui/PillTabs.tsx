import type { ReactNode } from 'react'
import SlidingPill from '../SlidingPill'

export interface PillTabItem {
  key: string
  /** 图标 / 文字 / 圆点 / 计数角标都拼进这里 */
  label: ReactNode
  /** 原 title 提示 */
  title?: string
  disabled?: boolean
}

export interface PillTabsProps {
  value: string
  onSelect: (key: string) => void
  items: PillTabItem[]
  orientation?: 'horizontal' | 'vertical'
  /** 布局类透传（mb-6 / ml-auto / shrink-0 / 轨道圆角与间距等现场差异） */
  className?: string
  /** 滑块缓存 key，同 SlidingPill trackId */
  trackId?: string
}

/** 标准胶囊按钮（全站唯一）：紧凑防挤压的 flex 项，纵向补满宽左对齐 */
const ITEM_BASE =
  'relative flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const ITEM_ACTIVE = 'text-gray-800 dark:text-gray-100'
const ITEM_IDLE = 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
const ITEM_VERTICAL = 'w-full justify-start'

/**
 * 通用胶囊 tab：轨道与滑块交给 SlidingPill（默认白滑块），
 * 调用方只给 items 与布局类，不再手写按钮样式。
 */
const PillTabs = ({
  value,
  onSelect,
  items,
  orientation = 'horizontal',
  className,
  trackId,
}: PillTabsProps) => (
  <SlidingPill value={value} orientation={orientation} className={className} trackId={trackId}>
    {items.map((item) => (
      <button
        key={item.key}
        type="button"
        data-pill-key={item.key}
        title={item.title}
        disabled={item.disabled}
        onClick={() => onSelect(item.key)}
        className={`${ITEM_BASE} ${orientation === 'vertical' ? ITEM_VERTICAL : ''} ${
          value === item.key ? ITEM_ACTIVE : ITEM_IDLE
        }`}
      >
        {item.label}
      </button>
    ))}
  </SlidingPill>
)

export default PillTabs
