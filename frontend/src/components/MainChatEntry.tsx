import { Home } from 'lucide-react'
import type { IMainChat } from '../types'

interface MainChatEntryProps {
  mainChat?: IMainChat
  selected?: boolean
  onSelect?: () => void
  /** 一级菜单样式：整行铺满、无卡片边框 */
  variant?: 'card' | 'row'
}

/** 主对话一级入口：对话与 Code 合并页共用，始终置顶 */
export default function MainChatEntry({ mainChat, selected, onSelect, variant = 'card' }: MainChatEntryProps) {
  if (!mainChat) return null
  const iconCls = `flex shrink-0 items-center justify-center rounded text-white ${
    variant === 'row' ? 'h-5 w-5' : 'h-5 w-5'
  } ${selected ? 'bg-white/25' : 'bg-gradient-to-br from-indigo-500 to-blue-600'}`

  if (variant === 'row') {
    return (
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
          selected
            ? 'bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-sm'
            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.04]'
        }`}
      >
        <span className={iconCls}>
          <Home size={11} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">主对话</span>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
          selected ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300'
        }`}>
          全局
        </span>
      </button>
    )
  }

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border px-2 py-1.5 transition-all ${
        selected
          ? 'border-indigo-300 bg-gradient-to-r from-indigo-500 to-blue-600 shadow-md shadow-indigo-500/20 dark:border-indigo-700'
          : 'border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 hover:border-indigo-200 dark:border-indigo-900/60 dark:from-indigo-950/50 dark:to-blue-950/50 dark:hover:border-indigo-700'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={iconCls}>
          <Home size={11} />
        </span>
        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}>
          主对话
        </span>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
          selected ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300'
        }`}>
          全局
        </span>
      </div>
    </div>
  )
}
