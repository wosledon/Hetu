import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'

export interface PaginationProps {
  page: number
  totalCount: number
  totalPages: number
  onPageChange: (page: number) => void
  /** 切换页时的占位数据态：禁用翻页按钮 */
  isPlaceholderData?: boolean
  className?: string
}

const PAGE_BTN_CLASS =
  'flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-400'

/** 列表底部分页条：总数 + 页码 + 上一页 / 下一页。总数不超过一页时整条隐藏 */
export default function Pagination({
  page,
  totalCount,
  totalPages,
  onPageChange,
  isPlaceholderData = false,
  className,
}: PaginationProps) {
  const { t } = useTranslation('common')
  if (totalPages <= 1) return null

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <span className="text-[11px] text-gray-400 dark:text-gray-500">
        {t('pagination.pageInfo', { page, totalPages })} · {t('pagination.totalCount', { count: totalCount })}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || isPlaceholderData}
          className={PAGE_BTN_CLASS}
        >
          <ChevronLeft size={13} />
          {t('pagination.prev')}
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || isPlaceholderData}
          className={PAGE_BTN_CLASS}
        >
          {t('pagination.next')}
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}
