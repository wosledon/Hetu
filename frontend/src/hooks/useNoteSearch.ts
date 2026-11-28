import { useEffect, useState } from 'react'
import { searchService } from '../services/searchService'
import type { INoteSearchResult, IPagedResult } from '../types'

interface NoteSearchOptions {
  /** 按标签查看时搜索保持同一范围 */
  tagId?: string
  includeDeleted?: boolean
}

interface NoteSearchResponse {
  keyword: string
  tagId?: string
  includeDeleted: boolean
  data: IPagedResult<INoteSearchResult>
}

const EMPTY_PAGE: IPagedResult<INoteSearchResult> = {
  items: [],
  totalCount: 0,
  page: 1,
  pageSize: 0,
  totalPages: 0,
}

/**
 * 全部笔记的标题 + 正文搜索（服务端）：输入停顿 300ms 自动查询，
 * 回包前保留上一次结果避免逐字清空闪屏；ready 只认与当前词完全一致的响应。
 */
export function useNoteSearch(term: string, { tagId, includeDeleted }: NoteSearchOptions = {}) {
  const keyword = term.trim()
  const [response, setResponse] = useState<NoteSearchResponse | null>(null)

  useEffect(() => {
    if (!keyword) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchService.searchNotes({ keyword, tagId, includeDeleted, page: 1, pageSize: 100 })
        .then((data) => {
          if (!cancelled) setResponse({ keyword, tagId, includeDeleted: !!includeDeleted, data })
        })
        .catch(() => {
          if (!cancelled) setResponse({ keyword, tagId, includeDeleted: !!includeDeleted, data: EMPTY_PAGE })
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [keyword, tagId, includeDeleted])

  const ready = !!response
    && response.keyword === keyword
    && response.tagId === tagId
    && response.includeDeleted === !!includeDeleted

  return {
    results: response?.data.items ?? [],
    total: response?.data.totalCount ?? 0,
    ready,
    inFlight: keyword.length > 0 && !ready,
  }
}