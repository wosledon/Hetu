import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { SearchInput } from './ui'

/** 常用 emoji（分组的精选集，避免引入外部依赖） */
const EMOJI_GROUPS: { key: string; emojis: string[] }[] = [
  {
    key: 'common',
    emojis: ['📝', '📄', '📋', '📌', '⭐', '❤️', '✅', '🚀', '💡', '🔥', '🎯', '🏷️', '📁', '🗂️', '🔖', '📎'],
  },
  {
    key: 'smileys',
    emojis: ['😀', '😄', '🥰', '😎', '🤔', '😴', '🤯', '😭', '😡', '🥳', '😇', '🤗', '😱', '🙃', '😤', '🫠'],
  },
  {
    key: 'nature',
    emojis: ['🌟', '🌈', '☀️', '🌙', '⛅', '🌊', '🌸', '🍀', '🌲', '🐱', '🐶', '🦊', '🐻', '🐼', '🦁', '🐝'],
  },
  {
    key: 'objects',
    emojis: ['💻', '⌨️', '🖥️', '📱', '🔧', '🔨', '⚙️', '🧰', '📚', '✏️', '🖊️', '📐', '🧮', '🔬', '🔭', '🧪'],
  },
  {
    key: 'symbols',
    emojis: ['➕', '➖', '❗', '❓', '⚠️', '🔔', '🔒', '🔑', '♻️', '🔗', '🧩', '🎨', '🎵', '🏆', '💰', '📈'],
  },
]

const ALL_EMOJIS = EMOJI_GROUPS.flatMap((g) => g.emojis)

interface EmojiPickerProps {
  /** 当前图标（emoji）；为空表示默认笔记图标 */
  value?: string
  /** 选择 emoji；传空串表示恢复默认图标 */
  onChange: (emoji: string) => void
  /** 触发器（通常是笔记图标按钮） */
  children: React.ReactNode
}

/**
 * 笔记图标选择器：点击触发器弹出 emoji 面板，选中即写入笔记。
 * 面板内可清除图标恢复默认笔记图标。
 */
export default function EmojiPicker({ value, onChange, children }: EmojiPickerProps) {
  const { t } = useTranslation('notes')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const emojis = search.trim()
    ? ALL_EMOJIS.filter((e) => e.includes(search.trim()))
    : ALL_EMOJIS

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title={t('icon.change')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base leading-none transition-colors hover:bg-gray-100 dark:hover:bg-white/10"
      >
        {children}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-gray-100 bg-white p-2 shadow-xl glass glass-float dark:border-gray-700 dark:bg-gray-800"
          onClick={(e) => e.stopPropagation()}
        >
          <SearchInput
            tone="blue"
            size="sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('icon.search')}
            className="mb-2 w-full"
          />
          <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto">
            {emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onChange(emoji)
                  setOpen(false)
                  setSearch('')
                }}
                className={`flex h-7 items-center justify-center rounded-md text-base transition-colors hover:bg-gray-100 dark:hover:bg-white/10 ${
                  value === emoji ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              onChange('')
              setOpen(false)
              setSearch('')
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border-t border-gray-100 pt-2 text-[11px] text-gray-400 transition-colors hover:text-blue-500 dark:border-gray-700 dark:text-gray-500"
          >
            <RotateCcw size={11} />
            {t('icon.reset')}
          </button>
        </div>
      )}
    </div>
  )
}
