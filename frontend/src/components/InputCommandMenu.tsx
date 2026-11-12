import React from 'react'
import { POPOVER_PANEL_CLASS, popoverItemClass } from '../utils/styles'

export interface InputCommandItem {
  key: string
  label: string
  description?: string
  icon: React.ReactNode
  tag?: string
  tagClass?: string
  /** 条目附加类型（对话页 / 指令区分的 skill / agent），供选中后路由 */
  type?: string
}

interface InputCommandMenuProps {
  title: string
  items: InputCommandItem[]
  selectedIndex: number
  onSelect: (item: InputCommandItem) => void
  itemRefs?: React.MutableRefObject<(HTMLButtonElement | null)[]>
  emptyHint?: string
}

/** 输入框 @ 提及 / / 指令 共用的浮层菜单 */
export default function InputCommandMenu({
  title,
  items,
  selectedIndex,
  onSelect,
  itemRefs,
  emptyHint,
}: InputCommandMenuProps) {
  if (items.length === 0 && !emptyHint) return null

  return (
    <div role="listbox" className={`absolute bottom-full left-0 right-0 z-50 mb-2 max-h-80 overflow-y-auto p-1.5 ${POPOVER_PANEL_CLASS}`}>
      <div className="mb-1 border-b border-gray-100 px-2.5 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:border-white/[0.06] dark:text-gray-500">{title}</div>
      {items.length === 0 && emptyHint && (
        <div className="px-4 py-6 text-center text-[11px] text-gray-400">{emptyHint}</div>
      )}
      {items.map((item, i) => (
        <button
          key={item.key}
          ref={el => {
            if (itemRefs) itemRefs.current[i] = el
          }}
          role="option"
          aria-selected={i === selectedIndex}
          onClick={() => onSelect(item)}
          className={`${popoverItemClass(i === selectedIndex)} items-center`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-50 dark:bg-white/[0.045]">{item.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{item.label}</div>
            {item.description && <div className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">{item.description}</div>}
          </div>
          {item.tag && (
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${item.tagClass ?? 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}>
              {item.tag}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
