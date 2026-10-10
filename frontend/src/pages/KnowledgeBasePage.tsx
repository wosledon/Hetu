import { confirm } from '../components/confirm'
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
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
  Layers,
  X,
  Brain,
  Clock,
  Hash,
  Upload,
  Globe,
  Plus,
  Trash2,
} from 'lucide-react'
import { formatDistanceToNow, isValid } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import i18n from '../i18n'

function safeFormatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return i18n.t('knowledge:kb.unknownTime')
  const d = new Date(dateStr)
  if (!isValid(d)) return i18n.t('knowledge:kb.unknownTime')
  return formatDistanceToNow(d, { addSuffix: true, locale: i18n.language === 'en' ? enUS : zhCN })
}

import AppLayout from '../components/AppLayout'
import HighlightText from '../components/HighlightText'
import Select from '../components/Select'
import {
  knowledgeBaseService,
  knowledgeItemService,
} from '../services/knowledgeBaseService'
import type {
  INoteChunk,
} from '../services/knowledgeBaseService'

type TabKey = 'overview' | 'manage' | 'search'
type ManageFilter = 'all' | 'note' | 'file' | 'url'

const tabs: { key: TabKey; label: string; icon: typeof Database }[] = [
  { key: 'overview', label: 'kb.tabOverview', icon: BarChart3 },
  { key: 'manage', label: 'kb.tabManage', icon: Database },
  { key: 'search', label: 'kb.tabSearch', icon: Search },
]

const typeFilters: { key: ManageFilter; label: string; icon: typeof FileText }[] = [
  { key: 'all', label: 'common:all', icon: Layers },
  { key: 'note', label: 'kb.typeNote', icon: FileText },
  { key: 'file', label: 'kb.typeFile', icon: Upload },
  { key: 'url', label: 'kb.typeUrl', icon: Globe },
]

export default function KnowledgeBasePage() {
  const { t } = useTranslation('knowledge')
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [manageFilter, setManageFilter] = useState<ManageFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchTopK, setSearchTopK] = useState(10)
  const [searchResults, setSearchResults] = useState<{ id: string; title: string; contentSnippet?: string; updatedAt: string }[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [chunkDetailId, setChunkDetailId] = useState<string | null>(null)
  const [chunkDetailTitle, setChunkDetailTitle] = useState<string>('')
  const [showAddUrl, setShowAddUrl] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Status - 批量索引期间自动轮询
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['knowledgeBaseStatus'],
    queryFn: knowledgeBaseService.getStatus,
    refetchInterval: (query) => {
      const s = query.state.data
      if (s && (s.unindexedItems > 0 || s.runningTaskCount > 0)) return 3000
      return false
    },
  })

  // Embedding statuses with filter - 有未索引项或运行中任务时自动轮询
  const { data: embeddingStatuses = [], isLoading: embeddingsLoading } = useQuery({
    queryKey: ['knowledgeBaseEmbeddings', manageFilter],
    queryFn: () => knowledgeBaseService.getEmbeddingStatuses(manageFilter === 'all' ? undefined : manageFilter),
    enabled: activeTab === 'manage',
    refetchInterval: activeTab === 'manage' && status && (status.unindexedItems > 0 || status.runningTaskCount > 0) ? 3000 : false,
  })

  // Knowledge items for manage tab
  useQuery({
    queryKey: ['knowledgeItems', manageFilter],
    queryFn: () => knowledgeItemService.getList(manageFilter === 'all' ? undefined : manageFilter),
    enabled: activeTab === 'manage',
  })

  // Chunk detail
  const { data: chunks = [], isLoading: chunksLoading } = useQuery({
    queryKey: ['noteChunks', chunkDetailId],
    queryFn: () => knowledgeBaseService.getChunks(chunkDetailId!),
    enabled: !!chunkDetailId,
  })

  // Generate single embedding
  const generateMutation = useMutation({
    mutationFn: (id: string) => knowledgeBaseService.generateEmbedding(id),
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

  // Add URL
  const addUrlMutation = useMutation({
    mutationFn: (request: { url: string; title?: string }) => knowledgeItemService.addUrl(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeItems'] })
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseStatus'] })
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseEmbeddings'] })
      setShowAddUrl(false)
      setUrlInput('')
      setUrlTitle('')
    },
  })

  // Delete item
  const deleteMutation = useMutation({
    mutationFn: (id: string) => knowledgeItemService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeItems'] })
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await knowledgeItemService.uploadFile(file)
      queryClient.invalidateQueries({ queryKey: ['knowledgeItems'] })
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseStatus'] })
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseEmbeddings'] })
    } catch (err) {
      console.error('上传失败:', err)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAddUrl = () => {
    if (!urlInput.trim()) return
    addUrlMutation.mutate({ url: urlInput.trim(), title: urlTitle.trim() || undefined })
  }

  // 覆盖率按 0~100 夹紧：已索引数来自后端统计，历史数据异常时也不会出现 200% 这种读数
  const indexedPercent = status
    ? status.totalItems > 0
      ? Math.min(100, Math.max(0, Math.round((status.indexedItems / status.totalItems) * 100)))
      : 0
    : 0

  const openChunkDetail = (id: string, title: string) => {
    setChunkDetailId(id)
    setChunkDetailTitle(title)
  }

  const closeChunkDetail = () => {
    setChunkDetailId(null)
    setChunkDetailTitle('')
  }

  // 获取知识项的类型图标
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'note': return <FileText size={14} />
      case 'file': return <Upload size={14} />
      case 'url': return <Globe size={14} />
      default: return <Database size={14} />
    }
  }

  const getTypeBadge = (type: string) => {
    const config = {
      note: { label: t('kb.typeNote'), className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
      file: { label: t('kb.typeFile'), className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
      url: { label: t('kb.typeUrl'), className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
    }
    const c = config[type as keyof typeof config] || { label: type, className: 'bg-gray-100 text-gray-600' }
    return (
      <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${c.className}`}>
        {getTypeIcon(type)}
        {c.label}
      </span>
    )
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-8 py-8">
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm shadow-emerald-500/20">
                  <Database size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('kb.title')}</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('kb.subtitle')}</p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{status?.totalItems ?? '-'}</b> {t('kb.statItems')}</span>
                <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                <span><b className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{status?.indexedItems ?? '-'}</b> {t('kb.statIndexed')}</span>
                <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                <span><b className="text-sm font-semibold text-violet-600 dark:text-violet-400">{indexedPercent}%</b> {t('kb.statCoverage')}</span>
              </div>
            </div>

            {/* Tabs */}
            <div className="mb-6 flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${
                      activeTab === tab.key
                        ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon size={14} />
                    {t(tab.label)}
                  </button>
                )
              })}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                {/* 索引驾驶舱：进度环 + 关键指标 + 批量操作 */}
                <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex flex-wrap items-center gap-8">
                    {/* 进度环 */}
                    <div className="relative h-24 w-24 shrink-0">
                      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" className="stroke-gray-100 dark:stroke-white/[0.06]" />
                        <circle
                          cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round"
                          className="stroke-emerald-500 transition-all duration-700"
                          strokeDasharray={`${(indexedPercent * 2.64).toFixed(1)} 264`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-bold text-gray-900 dark:text-gray-100">{indexedPercent}%</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('kb.statIndexed')}</span>
                      </div>
                    </div>

                    {/* 说明 + 状态 */}
                    <div className="min-w-[220px] flex-1">
                      <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('kb.cockpitTitle')}</h2>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {status ? t('kb.cockpitProgress', { indexed: status.indexedItems, total: status.totalItems }) : t('common:loading')}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          status?.hasEmbeddingProvider
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                        }`}>
                          {status?.hasEmbeddingProvider ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {status?.hasEmbeddingProvider ? t('kb.embeddingConfigured', { n: status.dimensions }) : t('kb.embeddingMissing')}
                        </span>
                        {status && status.runningTaskCount > 0 && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-600 dark:bg-teal-950/40 dark:text-teal-400">
                            <Loader2 size={12} className="animate-spin" />
                            {t('kb.tasksRunning', { n: status.runningTaskCount })}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 批量操作 */}
                    {status && status.unindexedItems > 0 ? (
                      <button
                        onClick={() => batchMutation.mutate()}
                        disabled={batchMutation.isPending || !status.hasEmbeddingProvider || status.runningTaskCount > 0}
                        className="flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md active:scale-[0.97] disabled:opacity-50"
                      >
                        {batchMutation.isPending || status.runningTaskCount > 0 ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Zap size={16} />
                        )}
                        {batchMutation.isPending ? t('kb.batchQueued') : status.runningTaskCount > 0 ? t('kb.batchRunning') : t('kb.batchGenerate', { n: status.unindexedItems })}
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <CheckCircle2 size={14} />
                        {t('kb.allIndexed')}
                      </div>
                    )}
                  </div>

                  {/* 关键指标 */}
                  <div className="mt-6 grid grid-cols-2 gap-2 border-t border-gray-100 pt-5 sm:grid-cols-3 lg:grid-cols-5 dark:border-gray-800">
                    <MetricPill icon={<Layers size={13} />} color="blue" label={t('kb.metricTotal')} value={status?.totalItems ?? '-'} loading={statusLoading} />
                    <MetricPill icon={<FileText size={13} />} color="indigo" label={t('kb.typeNote')} value={status?.noteCount ?? '-'} loading={statusLoading} />
                    <MetricPill icon={<Upload size={13} />} color="green" label={t('kb.typeFile')} value={status?.fileCount ?? '-'} loading={statusLoading} />
                    <MetricPill icon={<Globe size={13} />} color="purple" label={t('kb.typeUrl')} value={status?.urlCount ?? '-'} loading={statusLoading} />
                    <MetricPill icon={<AlertCircle size={13} />} color="amber" label={t('kb.notIndexed')} value={status?.unindexedItems ?? '-'} loading={statusLoading} />
                  </div>

                  {batchMutation.data && (
                    <p className="mt-4 text-xs text-green-600 dark:text-green-400">
                      {t('kb.batchResult', { n: batchMutation.data.queuedCount })}
                      {batchMutation.data.skippedCount > 0 && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">
                          {t('kb.batchSkipped', { n: batchMutation.data.skippedCount })}
                        </span>
                      )}
                    </p>
                  )}
                  {batchMutation.error && (
                    <p className="mt-4 text-xs text-red-600 dark:text-red-400">
                      {(batchMutation.error as Error).message}
                    </p>
                  )}
                </div>
              </div>
            )}
            {/* Manage Tab */}
            {activeTab === 'manage' && (
              <div className="space-y-4">
                {/* Type Filter + Actions */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                    {typeFilters.map((f) => {
                      const Icon = f.icon
                      return (
                        <button
                          key={f.key}
                          onClick={() => setManageFilter(f.key)}
                          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                            manageFilter === f.key
                              ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                          }`}
                        >
                          <Icon size={13} />
                          {t(f.label)}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Upload size={13} />
                      {t('kb.uploadFile')}
                    </button>
                    <button
                      onClick={() => setShowAddUrl(true)}
                      className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Plus size={13} />
                      {t('kb.addUrl')}
                    </button>
                  </div>
                </div>

                {/* Add URL Modal */}
                {showAddUrl && (
                  <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                    <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">{t('kb.addUrl')}</h3>
                    <div className="flex gap-3">
                      <input
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://example.com"
                        className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800"
                      />
                      <input
                        type="text"
                        value={urlTitle}
                        onChange={(e) => setUrlTitle(e.target.value)}
                        placeholder={t('kb.urlTitlePlaceholder')}
                        className="w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800"
                      />
                      <button
                        onClick={handleAddUrl}
                        disabled={addUrlMutation.isPending || !urlInput.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                      >
                        {addUrlMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        {t('common:add')}
                      </button>
                      <button
                        onClick={() => { setShowAddUrl(false); setUrlInput(''); setUrlTitle('') }}
                        className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        {t('common:cancel')}
                      </button>
                    </div>
                    {addUrlMutation.error && (
                      <p className="mt-2 text-xs text-red-500">{(addUrlMutation.error as Error).message}</p>
                    )}
                  </div>
                )}

                {/* Items List */}
                {embeddingsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 size={24} className="animate-spin text-gray-400" />
                  </div>
                ) : embeddingStatuses.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <Layers size={48} strokeWidth={1} />
                    <p className="mt-4 text-sm">{t('kb.empty')}</p>
                    <p className="mt-1 text-xs">{t('kb.emptyHint')}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {embeddingStatuses.map((item) => (
                      <div
                        key={item.id}
                        className={`group flex items-center gap-4 rounded-2xl border bg-white px-5 py-4 transition-all hover:shadow-md dark:bg-gray-900 ${
                          item.hasRunningTask
                            ? 'border-teal-300 bg-teal-50/30 dark:border-teal-700 dark:bg-teal-900/10'
                            : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700'
                        }`}
                      >
                        {/* Type + Title */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {getTypeBadge(item.type)}
                            <p className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                              {item.title || t('kb.untitled')}
                            </p>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                            {item.hasRunningTask
                              ? t('kb.indexing')
                              : item.embeddingUpdatedAt
                                ? t('kb.indexedAt', { time: safeFormatDate(item.embeddingUpdatedAt) })
                                : t('kb.notIndexed')}
                          </p>
                        </div>

                        {/* Status badges */}
                        <div className="flex items-center gap-2">
                          {item.hasRunningTask ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                              <Loader2 size={10} className="animate-spin" />
                              {t('kb.badgeIndexing')}
                            </span>
                          ) : item.hasEmbedding ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              <CheckCircle2 size={10} />
                              {t('kb.statIndexed')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              <AlertCircle size={10} />
                              {t('kb.notIndexed')}
                            </span>
                          )}

                          {item.embeddingModel && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
                              <Brain size={10} />
                              {item.embeddingModel}
                            </span>
                          )}

                          {item.embeddingDimensions > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
                              <Hash size={10} />
                              {item.embeddingDimensions}d
                            </span>
                          )}

                          {item.chunkCount > 0 && (
                            <button
                              onClick={() => openChunkDetail(item.id, item.title)}
                              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                              title={t('kb.chunkCountTitle')}
                            >
                              <Layers size={10} />
                              {t('kb.chunkCount', { n: item.chunkCount })}
                            </button>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => generateMutation.mutate(item.id)}
                            disabled={generateMutation.isPending || item.hasRunningTask}
                            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-blue-600 transition-all hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                          >
                            {item.hasRunningTask || generateMutation.isPending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            {item.hasRunningTask ? t('kb.actionIndexing') : item.hasEmbedding ? t('kb.actionReindex') : t('kb.actionIndex')}
                          </button>
                          {item.type !== 'note' && (
                            <button
                              onClick={() => {
                                confirm({ message: t('kb.deleteItemConfirm'), onConfirm: () => deleteMutation.mutate(item.id) })
                              }}
                              className="flex items-center gap-1 rounded-full p-1.5 text-red-400 transition-all hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                              title={t('kb.deleteItemTitle')}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Search Test Tab */}
            {activeTab === 'search' && (
              <div className="space-y-6">
                {/* Search Input */}
                <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                  <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">{t('kb.searchTestTitle')}</h3>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder={t('kb.searchPlaceholder')}
                        className="w-full rounded-full border border-gray-200 bg-white py-2.5 pl-11 pr-4 text-sm outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-blue-950/40"
                      />
                    </div>
                    <div className="relative">
                      <Select
                        value={searchTopK.toString()}
                        onChange={(value) => setSearchTopK(Number(value))}
                        options={[
                          { value: '5', label: 'Top 5' },
                          { value: '10', label: 'Top 10' },
                          { value: '20', label: 'Top 20' },
                        ]}
                      />
                    </div>
                    <button
                      onClick={handleSearch}
                      disabled={isSearching || !searchQuery.trim()}
                      className="flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md active:scale-[0.97] disabled:opacity-50"
                    >
                      {isSearching ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Play size={16} />
                      )}
                      {t('common:search')}
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
                        {t('kb.searchResults', { n: searchResults.length })}
                      </h3>
                    </div>
                    {searchResults.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                        <Search size={48} strokeWidth={1} />
                        <p className="mt-4 text-sm">{t('kb.searchEmpty')}</p>
                        <p className="mt-1 text-xs">{t('kb.searchEmptyHint')}</p>
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
                                {safeFormatDate(result.updatedAt)}
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

          {/* Chunk Detail Modal */}
          {chunkDetailId && (
            <ChunkDetailModal
              title={chunkDetailTitle}
              chunks={chunks}
              loading={chunksLoading}
              onClose={closeChunkDetail}
            />
          )}
        </div>
      }
    />
  )
}

/* ─── Chunk Detail Modal ─── */

function ChunkDetailModal({
  title,
  chunks,
  loading,
  onClose,
}: {
  title: string
  chunks: INoteChunk[]
  loading: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('knowledge')
  const [expandedChunkId, setExpandedChunkId] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-[80vh] w-[640px] flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-[#12151f]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/[0.06]">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-50">{t('kb.chunkModalTitle')}</h3>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{title}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {t('kb.chunkCount', { n: chunks.length })}
            </span>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : chunks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Layers size={48} strokeWidth={1} />
              <p className="mt-4 text-sm">{t('kb.chunkEmpty')}</p>
              <p className="mt-1 text-xs">{t('kb.chunkEmptyHint')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk) => {
                const isExpanded = expandedChunkId === chunk.id
                return (
                  <div
                    key={chunk.id}
                    className="rounded-xl border border-gray-200 bg-white transition-all dark:border-gray-800 dark:bg-gray-900"
                  >
                    <button
                      onClick={() => setExpandedChunkId(isExpanded ? null : chunk.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
                        {chunk.chunkIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-gray-700 dark:text-gray-300">
                          {chunk.summary || chunk.content.slice(0, 80) + (chunk.content.length > 80 ? '...' : '')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          chunk.chunkMethod === 'llm'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'
                        }`}>
                          {chunk.chunkMethod === 'llm' ? 'LLM' : t('kb.chunkMethodStructured')}
                        </span>
                        {chunk.hasEmbedding ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            <CheckCircle2 size={8} />
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                            <AlertCircle size={8} />
                          </span>
                        )}
                        <ChevronDown size={14} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-3 dark:border-white/[0.06]">
                        {chunk.summary && (
                          <div className="mb-3">
                            <p className="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">{t('kb.chunkSummary')}</p>
                            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{chunk.summary}</p>
                          </div>
                        )}
                        <div>
                          <p className="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">{t('kb.chunkRawContent')}</p>
                          <div className="max-h-48 overflow-y-auto rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
                            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                              {chunk.content}
                            </pre>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-400 dark:text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {safeFormatDate(chunk.updatedAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Hash size={10} />
                            {t('common:charCount', { count: chunk.content.length })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Metric Pill ─── */

function MetricPill({
  icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: 'blue' | 'green' | 'amber' | 'purple' | 'indigo'
  loading: boolean
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    indigo: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-gray-50/80 px-3.5 py-3 dark:bg-white/[0.03]">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colorMap[color]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-400 dark:text-gray-500">{label}</p>
        {loading ? (
          <div className="mt-0.5 h-5 w-10 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : (
          <p className="text-lg font-bold leading-tight text-gray-800 dark:text-gray-100">{value}</p>
        )}
      </div>
    </div>
  )
}
