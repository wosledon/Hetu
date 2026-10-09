import React from 'react'

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
    <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">{title}</div>
      {items.length === 0 && emptyHint && (
        <div className="px-3 py-3 text-center text-[11px] text-gray-400">{emptyHint}</div>
      )}
      {items.map((item, i) => (
        <button
          key={item.key}
          ref={el => {
            if (itemRefs) itemRefs.current[i] = el
          }}
          onClick={() => onSelect(item)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
            i === selectedIndex
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50'
          }`}
        >
          <span className="shrink-0 text-base">{item.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{item.label}</div>
            {item.description && <div className="truncate text-[11px] text-gray-400">{item.description}</div>}
          </div>
          {item.tag && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${item.tagClass ?? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
              {item.tag}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** 在光标前提取正在输入的 @ 查询词；不在提及位置时返回 null */
export function extractMentionQuery(input: string, cursor: number): string | null {
  const uptoCursor = input.slice(0, cursor)
  const at = uptoCursor.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(uptoCursor[at - 1])) return null
  const query = uptoCursor.slice(at + 1)
  return /\s/.test(query) ? null : query
}

/** 在光标前提取正在输入的 / 指令查询词；仅输入框开头生效 */
export function extractSlashQuery(input: string, cursor: number): string | null {
  if (!input.startsWith('/')) return null
  const uptoCursor = input.slice(0, cursor)
  return /\s/.test(uptoCursor) ? null : uptoCursor.slice(1)
}
