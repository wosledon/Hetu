import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { List } from 'lucide-react'
import type { NoteTocItem } from '../utils/noteToc'

export interface NoteTocProps {
  items: NoteTocItem[]
  /** 当前滚动到的标题序号（高亮 + 自动滚入可见区） */
  activeIndex: number
  onSelect: (index: number) => void
}

/**
 * 笔记左侧的导航目录：正文标题的缩进列表，点击平滑滚动到对应标题，
 * 滚动时高亮当前所在章节。只在正文有标题时出现。
 */
export default function NoteToc({ items, activeIndex, onSelect }: NoteTocProps) {
  const { t } = useTranslation('notes')
  const activeRef = useRef<HTMLButtonElement>(null)

  // 当前章节变化时把它滚进目录可见区（不带动画，避免和正文滚动动画互相打断）
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <nav className="mr-3 w-52 shrink-0 overflow-y-auto border-r border-gray-100 px-2 py-4 dark:border-gray-800/50" aria-label={t('editor.toc')}>
      <div className="mb-1.5 flex items-center gap-1.5 px-2 text-[11px] font-medium text-gray-400 dark:text-gray-500">
        <List size={12} />
        {t('editor.toc')}
      </div>
      {items.map((item, index) => {
        const active = index === activeIndex
        return (
          <button
            key={`${index}-${item.text}`}
            ref={active ? activeRef : null}
            onClick={() => onSelect(index)}
            title={item.text}
            className={`block w-full truncate rounded-md py-1 pr-2 text-left text-[12px] leading-5 transition-colors ${
              active
                ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'
                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]'
            }`}
            style={{ paddingLeft: `${(item.level - 1) * 10 + 8}px` }}
          >
            {item.text}
          </button>
        )
      })}
    </nav>
  )
}
