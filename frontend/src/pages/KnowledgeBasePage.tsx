import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database,
  FileText,
  CheckCircle2,
  AlertCircle,
  Search,
  RefreshCw,
  Loader2,
  Zap,
  BarChart3,
  Play,
  ChevronDown,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import AppLayout from '../components/AppLayout'
import HighlightText from '../components/HighlightText'
import { knowledgeBaseService } from '../services/knowledgeBaseService'
import type { INoteSearchResult } from '../types'

type TabKey = 'overview' | 'manage' | 'search'

const tabs: { key: TabKey; label: string; icon: typeof Database }[] = [
  { key: 'overview', label: '概览', icon: BarChart3 },
  { key: 'manage', label: '索引管理', icon: Database },
  { key: 'search', label: '搜索测试', icon: Search },
]

export default function KnowledgeBasePage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchTopK, setSearchTopK] = useState(10)
  const [searchResults, setSearchResults] = useState<INoteSearchResult[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['knowledgeBaseStatus'],
    queryFn: knowledgeBaseService.getStatus,
  })

  // Embedding statuses
  const { data: embeddingStatuses = [], isLoading: embeddingsLoading } = useQuery({
    queryKey: ['knowledgeBaseEmbeddings'],
    queryFn: knowledgeBaseService.getEmbeddingStatuses,
    enabled: activeTab === 'manage',
  })

  // Generate single embedding
  const generateMutation = useMutation({
    mutationFn: (noteId: string) => knowledgeBaseService.generateEmbedding(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseStatus'] })
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseEmbeddings'] })
    },
  })

  // Batch generate
  const batchMutation = useMutation({
    mutationFn: knowledgeBaseService.batchGenerateEmbeddings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseStatus'] })
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseEmbeddings'] })
    },
  })

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    setSearchError(null)
    setSearchResults(null)
    try {
      const result = await knowledgeBaseService.testSearch({ query: searchQuery, topK: searchTopK })
      setSearchResults(result.items)
    } catch (err) {
      setSearchError((err as Error).message)
    } finally {
      setIsSearching(false)
    }
  }

  const indexedPercent = status ? (status.totalNotes > 0 ? Math.round((status.indexedNotes / status.totalNotes) * 100) : 0) : 0

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-5xl px-8 py-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm shadow-violet-500/20">
                  <Database size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">知识库</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">管理笔记的向量索引，测试语义搜索</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="mb-6 flex items-center gap-1 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.06]">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                      activeTab === tab.key
                        ? 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon size={15} />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Status Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatusCard
                    icon={<FileText size={20} />}
                    label="总笔记数"
                    value={status?.totalNotes ?? '-'}
                    color="blue"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<CheckCircle2 size={20} />}
                    label="已索引"
                    value={status?.indexedNotes ?? '-'}
                    color="green"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<AlertCircle size={20} />}
                    label="未索引"
                    value={status?.unindexedNotes ?? '-'}
                    color="amber"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<Zap size={20} />}
                    label="向量维度"
                    value={status?.dimensions ?? '-'}
                    color="purple"
                    loading={statusLoading}
                  />
                </div>

                {/* Progress Bar */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">索引进度</h3>
                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{indexedPercent}%</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                      style={{ width: `${indexedPercent}%` }}
                    />
                  </div>
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    {status ? `${status.indexedNotes} / ${status.totalNotes} 笔记已生成向量索引` : '加载中...'}
                  </p>
                </div>

                {/* Provider Status */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                  <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">Embedding 提供者</h3>
                  {status?.hasEmbeddingProvider ? (
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                        <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">已配置</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">向量维度: {status.dimensions}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                        <AlertCircle size={16} className="text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">未配置</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">请在设置中配置 Embedding 模型</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Batch Action */}
                {status && status.unindexedNotes > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">批量索引</h3>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          为 {status.unindexedNotes} 篇未索引笔记生成向量
                        </p>
                      </div>
                      <button
                        onClick={() => batchMutation.mutate()}
                        disabled={batchMutation.isPending || !status.hasEmbeddingProvider}
                        className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                      >
                        {batchMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Zap size={16} />
                        )}
                        {batchMutation.isPending ? '排队中...' : '批量生成'}
                      </button>
                    </div>
                    {batchMutation.data && (
                      <p className="mt-3 text-sm text-green-600 dark:text-green-400">
                        已将 {batchMutation.data.queuedCount} 篇笔记加入队列
                      </p>
                    )}
                    {batchMutation.error && (
                      <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                        {(batchMutation.error as Error).message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Manage Tab */}
            {activeTab === 'manage' && (
              <div className="space-y-4">
                {embeddingsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 size={24} className="animate-spin text-gray-400" />
                  </div>
                ) : embeddingStatuses.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <FileText size={48} strokeWidth={1} />
                    <p className="mt-4 text-sm">暂无笔记</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                          <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">笔记标题</th>
                          <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">索引状态</th>
                          <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">模型</th>
                          <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">维度</th>
                          <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">分块</th>
                          <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">更新时间</th>
                          <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {embeddingStatuses.map((item) => (
                          <tr key={item.noteId} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                            <td className="px-4 py-3">
                              <span className="font-medium text-gray-900 dark:text-gray-100">{item.title || '无标题'}</span>
                            </td>
                            <td className="px-4 py-3">
                              {item.hasEmbedding ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                  <CheckCircle2 size={12} />
                                  已索引
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  <AlertCircle size={12} />
                                  未索引
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                              {item.embeddingModel ?? '-'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                              {item.embeddingDimensions || '-'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                              {item.chunkCount > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                  {item.chunkCount} 块
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                              {item.embeddingUpdatedAt
                                ? formatDistanceToNow(new Date(item.embeddingUpdatedAt), { addSuffix: true, locale: zhCN })
                                : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => generateMutation.mutate(item.noteId)}
                                disabled={generateMutation.isPending}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-all hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                              >
                                {generateMutation.isPending ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={12} />
                                )}
                                {item.hasEmbedding ? '重新索引' : '生成索引'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Search Test Tab */}
            {activeTab === 'search' && (
              <div className="space-y-6">
                {/* Search Input */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                  <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">语义搜索测试</h3>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="输入查询内容，测试语义搜索效果..."
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800"
                      />
                    </div>
                    <div className="relative">
                      <select
                        value={searchTopK}
                        onChange={(e) => setSearchTopK(Number(e.target.value))}
                        className="appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-3 pr-8 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800"
                      >
                        <option value={5}>Top 5</option>
                        <option value={10}>Top 10</option>
                        <option value={20}>Top 20</option>
                      </select>
                      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>
                    <button
                      onClick={handleSearch}
                      disabled={isSearching || !searchQuery.trim()}
                      className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                    >
                      {isSearching ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Play size={16} />
                      )}
                      搜索
                    </button>
                  </div>
                </div>

                {/* Search Results */}
                {searchError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <AlertCircle size={16} />
                      <span className="text-sm">{searchError}</span>
                    </div>
                  </div>
                )}

                {searchResults && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        搜索结果 ({searchResults.length})
                      </h3>
                    </div>
                    {searchResults.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                        <Search size={48} strokeWidth={1} />
                        <p className="mt-4 text-sm">未找到相关结果</p>
                        <p className="mt-1 text-xs">尝试使用不同的关键词，或确保笔记已生成索引</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {searchResults.map((result, index) => (
                          <div
                            key={result.id}
                            className="rounded-xl border border-gray-200 bg-white p-4 transition-all hover:shadow-sm dark:border-gray-800 dark:bg-gray-900"
                          >
                            <div className="flex items-start justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                    {index + 1}
                                  </span>
                                  <h4 className="truncate font-medium text-gray-900 dark:text-gray-100">
                                    <HighlightText text={result.title} keyword={searchQuery} />
                                  </h4>
                                </div>
                                {result.contentSnippet && (
                                  <p className="mt-2 pl-7 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                                    <HighlightText text={result.contentSnippet} keyword={searchQuery} />
                                  </p>
                                )}
                              </div>
                              <span className="ml-4 shrink-0 text-xs text-gray-400">
                                {formatDistanceToNow(new Date(result.updatedAt), { addSuffix: true, locale: zhCN })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      }
    />
  )
}

function StatusCard({
  icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: 'blue' | 'green' | 'amber' | 'purple'
  loading: boolean
}) {
  const colorMap = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color]}`}>
          {icon}
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          ) : (
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
          )}
        </div>
      </div>
    </div>
  )
}
