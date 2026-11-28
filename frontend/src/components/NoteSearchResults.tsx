import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { FileText, Loader2, SearchX } from 'lucide-react'
import type { INoteSearchResult } from '../types'
import { uiLocale } from '../utils/locale'
import { highlightSearchMatches, plainSearchSnippet } from '../utils/searchHighlight'
import { SurfaceButton } from './ui'

/**
 * 笔记搜索的结果列表（笔记页树/列表、回收站共用）：
 * 命中词高亮 + 两行正文摘要；↑↓ 选中项自动滚入视野，视觉与主对话搜索一致。
 */
export default function NoteSearchResults({
  keyword,
  results,
  total,
  ready,
  inFlight,
  activeIndex,
  selectedNoteId,
  onHover,
  onOpen,
}: {
  keyword: string
  results: INoteSearchResult[]
  total: number
  ready: boolean
  inFlight: boolean
  activeIndex: number
  selectedNoteId?: string
  onHover: (index: number) => void
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('notes')
  const active = results.length > 0 ? Math.min(activeIndex, results.length - 1) : -1
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (active < 0) return
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!ready && results.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-[11px] text-gray-400 dark:text-gray-500">
        <Loader2 size={13} className="animate-spin" />
        {t('search.searching')}
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-100/80 dark:bg-white/[0.05]">
          <SearchX size={17} className="text-gray-400 dark:text-gray-500" />
        </div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('search.empty', { keyword })}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">
          {t('search.emptyHint')}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
          {t('search.resultCount', { count: total })}
        </span>
        {inFlight && <Loader2 size={11} className="animate-spin text-gray-300 dark:text-gray-600" />}
      </div>
      <div className="space-y-0.5">
        {results.map((r, index) => {
          const isActive = index === active
          const isSelected = r.id === selectedNoteId
          const snippet = r.contentSnippet ? plainSearchSnippet(r.contentSnippet) : ''
          return (
            <SurfaceButton
              key={r.id}
              ref={(el) => { itemRefs.current[index] = el }}
              variant="row"
              selected={isActive || isSelected}
              onClick={() => onOpen(r.id)}
              onMouseEnter={() => onHover(index)}
            >
              <div className="flex items-center gap-1.5">
                <FileText size={12} className="shrink-0 text-gray-400 dark:text-gray-500" />
                <span className={`line-clamp-1 min-w-0 flex-1 text-[12.5px] leading-snug ${isActive ? 'font-medium text-blue-700 dark:text-blue-200' : 'font-medium text-gray-700 dark:text-gray-200'}`}>
                  {highlightSearchMatches(r.title, keyword)}
                </span>
                <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                  {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true, locale: uiLocale() === 'en' ? enUS : zhCN })}
                </span>
              </div>
              {snippet && (
                <p className="mt-1 line-clamp-2 pl-[18px] text-[11px] leading-[1.6] text-gray-500 dark:text-gray-400">
                  {highlightSearchMatches(snippet, keyword)}
                </p>
              )}
            </SurfaceButton>
          )
        })}
      </div>
    </div>
  )
}