import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Sparkles, FileText, Hash, MessageSquare, X, Command } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import AppLayout from '../components/AppLayout'
import HighlightText from '../components/HighlightText'
import { searchService } from '../services/searchService'
import { noteService } from '../services/noteService'
import type { INote, INoteSearchResult } from '../types'

type SearchMode = 'keyword' | 'semantic'
type SearchTab = 'all' | 'notes' | 'chats' | 'tags'

const searchTabs: { key: SearchTab; label: string; icon: typeof FileText }[] = [
  { key: 'all', label: '全部', icon: Search },
  { key: 'notes', label: '笔记', icon: FileText },
  { key: 'chats', label: '对话', icon: MessageSquare },
  { key: 'tags', label: '标签', icon: Hash },
]

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-800" />
      </div>
      <div className="mb-2 h-5 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-4 w-full rounded bg-gray-100 dark:bg-gray-800" />
      <div className="mt-1 h-4 w-2/3 rounded bg-gray-100 dark:bg-gray-800" />
    </div>
  )
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')
  const [activeTab, setActiveTab] = useState<SearchTab>('all')
  const [selectedNote, setSelectedNote] = useState<INote | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['search', searchMode, query],
    queryFn: () =>
      searchMode === 'keyword'
        ? searchService.searchNotes({ keyword: query, page: 1, pageSize: 20 })
        : searchService.semanticSearch(query, 20),
    enabled: query.trim().length > 0,
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleResultClick = async (result: INoteSearchResult) => {
    const note = await noteService.getById(result.id)
    setSelectedNote(note)
  }

  const hasResults = data && data.items.length > 0

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex flex-1 flex-col overflow-hidden bg-gradient-to-b from-gray-50 to-white dark:from-[#0c0f1a] dark:to-[#0c0f1a]">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
            {/* Header */}
            <div className="mb-8 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-gray-800 dark:text-gray-100">搜索</h1>
              <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">在笔记、对话和标签中搜索</p>
            </div>

            {/* Search Input */}
            <div className="relative mb-5">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <Search size={18} className={query ? 'text-blue-500' : 'text-gray-400'} />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入关键词搜索..."
                autoFocus
                className="w-full rounded-2xl border border-gray-200 bg-white py-3.5 pl-11 pr-20 text-[15px] shadow-sm outline-none transition-all focus:border-blue-300 focus:shadow-md focus:shadow-blue-500/10 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-blue-500/40"
              />
              <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-3">
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                  >
                    <X size={16} />
                  </button>
                )}
                <kbd className="hidden items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:flex dark:border-gray-700 dark:bg-gray-800">
                  <Command size={10} />K
                </kbd>
              </div>
            </div>

            {/* Tabs + Mode Toggle */}
            <div className="mb-6 flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                {searchTabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
                        activeTab === tab.key
                          ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      }`}
                    >
                      <Icon size={13} />
                      {tab.label}
                    </button>
                  )
                })}
              </div>
              <div className="flex-1" />
              <button
                onClick={() => setSearchMode(searchMode === 'semantic' ? 'keyword' : 'semantic')}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium transition-all ${
                  searchMode === 'semantic'
                    ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.06]'
                }`}
                title="切换语义搜索"
              >
                <Sparkles size={13} />
                语义搜索
              </button>
            </div>

            {/* Results Count */}
            {query.trim() && hasResults && (
              <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
                找到 <span className="font-semibold text-gray-600 dark:text-gray-300">{data.items.length}</span> 个结果
              </p>
            )}

            {/* Results */}
            <div className="flex-1 space-y-3 overflow-y-auto pb-8">
              {isLoading ? (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              ) : !query.trim() ? (
                <div className="flex flex-col items-center justify-center py-24">
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.06]">
                    <Search size={36} className="text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-400 dark:text-gray-500">输入关键词开始搜索</p>
                  <p className="mt-1 text-xs text-gray-300 dark:text-gray-600">支持笔记标题、内容、标签搜索</p>
                </div>
              ) : data?.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24">
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.06]">
                    <Search size={36} className="text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-400 dark:text-gray-500">未找到相关结果</p>
                  <p className="mt-1 text-xs text-gray-300 dark:text-gray-600">试试其他关键词或切换搜索模式</p>
                </div>
              ) : (
                data.items.map((result, index) => (
                  <div
                    key={result.id}
                    onClick={() => handleResultClick(result)}
                    style={{ animationDelay: `${index * 40}ms` }}
                    className={`group cursor-pointer rounded-xl border p-5 transition-all animate-fade-in ${
                      selectedNote?.id === result.id
                        ? 'border-blue-200 bg-blue-50/80 shadow-sm dark:border-blue-500/30 dark:bg-blue-500/10'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {searchMode === 'semantic' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                            <Sparkles size={10} />
                            语义匹配
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                            <FileText size={10} />
                            笔记
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-300 transition-colors group-hover:text-gray-400 dark:text-gray-600 dark:group-hover:text-gray-500">
                        {formatDistanceToNow(new Date(result.updatedAt), { addSuffix: true, locale: zhCN })}
                      </span>
                    </div>
                    <h3 className="mb-1.5 text-[15px] font-semibold text-gray-800 dark:text-gray-100">
                      <HighlightText text={result.title || '未命名笔记'} keyword={query} />
                    </h3>
                    <p className="line-clamp-2 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                      <HighlightText text={result.contentSnippet || '无内容预览'} keyword={query} />
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      }
    >
      {null}
    </AppLayout>
  )
}
