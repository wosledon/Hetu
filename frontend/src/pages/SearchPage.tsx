import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Sparkles, Filter, FileText } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import AppLayout from '../components/AppLayout'
import HighlightText from '../components/HighlightText'
import { searchService } from '../services/searchService'
import { noteService } from '../services/noteService'
import type { INote, INoteSearchResult } from '../types'

type SearchMode = 'keyword' | 'semantic'
type SearchTab = 'all' | 'notes' | 'chats' | 'tags'

const searchTabs: { key: SearchTab; label: string }[] = [
  { key: 'all', label: '全部结果' },
  { key: 'notes', label: '笔记' },
  { key: 'chats', label: '对话' },
  { key: 'tags', label: '标签' },
]

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')
  const [activeTab, setActiveTab] = useState<SearchTab>('all')
  const [selectedNote, setSelectedNote] = useState<INote | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['search', searchMode, query],
    queryFn: () =>
      searchMode === 'keyword'
        ? searchService.searchNotes({ keyword: query, page: 1, pageSize: 20 })
        : searchService.semanticSearch(query, 20),
    enabled: query.trim().length > 0,
  })

  const handleResultClick = async (result: INoteSearchResult) => {
    const note = await noteService.getById(result.id)
    setSelectedNote(note)
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-4xl px-8 py-8">
            <div className="mb-8">
              <div className="relative">
                <Search size={22} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索笔记、对话、标签..."
                  className="w-full rounded-xl border-2 border-gray-300 bg-white py-4 pl-12 pr-4 text-lg outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
              <div className="mt-4 flex items-center gap-3">
                {searchTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${
                      activeTab === tab.key
                        ? 'bg-blue-500 text-white'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  onClick={() => setSearchMode(searchMode === 'semantic' ? 'keyword' : 'semantic')}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${
                    searchMode === 'semantic'
                      ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                  title="切换语义搜索"
                >
                  <Sparkles size={15} />
                  {searchMode === 'semantic' ? '语义搜索' : '语义搜索'}
                </button>
                <button
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  title="高级筛选"
                >
                  <Filter size={15} />
                  高级筛选
                </button>
              </div>
            </div>

            {query.trim() && (
              <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
                找到 <span className="font-semibold text-gray-800 dark:text-gray-100">{data?.items.length ?? 0}</span> 个相关结果
              </p>
            )}

            <div className="space-y-4">
              {isLoading ? (
                <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900">搜索中...</div>
              ) : !query.trim() ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-900">输入关键词开始搜索</div>
              ) : data?.items.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900">未找到相关笔记</div>
              ) : (
                data?.items.map((result) => (
                  <div
                    key={result.id}
                    onClick={() => handleResultClick(result)}
                    className={`cursor-pointer rounded-lg border p-5 transition-shadow hover:shadow-md ${
                      selectedNote?.id === result.id
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30'
                        : searchMode === 'semantic'
                          ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20'
                          : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {searchMode === 'semantic' ? (
                          <>
                            <Sparkles size={14} className="text-green-600 dark:text-green-300" />
                            <span className="text-green-700 dark:text-green-300">语义相关</span>
                          </>
                        ) : (
                          <>
                            <FileText size={14} className="text-blue-500" />
                            <span className="text-blue-600">笔记</span>
                          </>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(result.updatedAt), { addSuffix: true, locale: zhCN })}
                      </span>
                    </div>
                    <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-gray-100">
                      <HighlightText text={result.title || '未命名笔记'} keyword={query} />
                    </h3>
                    <p className="line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                      <HighlightText text={result.contentSnippet || '无内容'} keyword={query} />
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
