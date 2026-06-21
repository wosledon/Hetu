import { useState, useRef } from 'react'
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
  Link,
  Upload,
  Globe,
  Plus,
  Trash2,
} from 'lucide-react'
import { formatDistanceToNow, isValid } from 'date-fns'
import { zhCN } from 'date-fns/locale'

function safeFormatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '未知时间'
  const d = new Date(dateStr)
  if (!isValid(d)) return '未知时间'
  return formatDistanceToNow(d, { addSuffix: true, locale: zhCN })
}

import AppLayout from '../components/AppLayout'
import HighlightText from '../components/HighlightText'
import {
  knowledgeBaseService,
  knowledgeItemService,
} from '../services/knowledgeBaseService'
import type {
  IKnowledgeItemEmbeddingStatus,
  INoteChunk,
  IKnowledgeItem,
} from '../services/knowledgeBaseService'

type TabKey = 'overview' | 'manage' | 'search'
type ManageFilter = 'all' | 'note' | 'file' | 'url'

const tabs: { key: TabKey; label: string; icon: typeof Database }[] = [
  { key: 'overview', label: '概览', icon: BarChart3 },
  { key: 'manage', label: '索引管理', icon: Database },
  { key: 'search', label: '搜索测试', icon: Search },
]

const typeFilters: { key: ManageFilter; label: string; icon: typeof FileText }[] = [
  { key: 'all', label: '全部', icon: Layers },
  { key: 'note', label: '笔记', icon: FileText },
  { key: 'file', label: '文件', icon: Upload },
  { key: 'url', label: '网址', icon: Globe },
]

export default function KnowledgeBasePage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [manageFilter, setManageFilter] = useState<ManageFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchTopK, setSearchTopK] = useState(10)
  const [searchResults, setSearchResults] = useState<{ id: string; title: string; contentSnippet: string; updatedAt: string }[] | null>(null)
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
      // 如果有未索引项，每 3 秒轮询一次
      const s = query.state.data
      if (s && s.unindexedItems > 0) return 3000
      return false
    },
  })

  // Embedding statuses with filter - 有未索引项时自动轮询
  const { data: embeddingStatuses = [], isLoading: embeddingsLoading } = useQuery({
    queryKey: ['knowledgeBaseEmbeddings', manageFilter],
    queryFn: () => knowledgeBaseService.getEmbeddingStatuses(manageFilter === 'all' ? undefined : manageFilter),
    enabled: activeTab === 'manage',
    refetchInterval: activeTab === 'manage' && status && status.unindexedItems > 0 ? 3000 : false,
  })

  // Knowledge items for manage tab
  const { data: knowledgeItems = [] } = useQuery({
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

  const indexedPercent = status ? (status.totalItems > 0 ? Math.round((status.indexedItems / status.totalItems) * 100) : 0) : 0
  const totalChunks = embeddingStatuses.reduce((sum, s) => sum + s.chunkCount, 0)

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
      note: { label: '笔记', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
      file: { label: '文件', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
      url: { label: '网址', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
    }
    const c = config[type as keyof typeof config] || { label: type, className: 'bg-gray-100 text-gray-600' }
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${c.className}`}>
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
          <div className="mx-auto max-w-5xl px-8 py-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm shadow-violet-500/20">
                  <Database size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">知识库</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">管理笔记、文件、网址的向量索引与文档分块</p>
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
                  <StatusCard
                    icon={<Layers size={20} />}
                    label="总项目数"
                    value={status?.totalItems ?? '-'}
                    color="blue"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<FileText size={20} />}
                    label="笔记"
                    value={status?.noteCount ?? '-'}
                    color="indigo"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<Upload size={20} />}
                    label="文件"
                    value={status?.fileCount ?? '-'}
                    color="green"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<Globe size={20} />}
                    label="网址"
                    value={status?.urlCount ?? '-'}
                    color="purple"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<CheckCircle2 size={20} />}
                    label="已索引"
                    value={status?.indexedItems ?? '-'}
                    color="green"
                    loading={statusLoading}
                  />
                  <StatusCard
                    icon={<AlertCircle size={20} />}
                    label="未索引"
                    value={status?.unindexedItems ?? '-'}
                    color="amber"
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
                    {status ? `${status.indexedItems} / ${status.totalItems} 知识项已生成向量索引` : '加载中...'}
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
                {status && status.unindexedItems > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">批量索引</h3>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          为 {status.unindexedItems} 个未索引知识项生成向量
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
                        已将 {batchMutation.data.queuedCount} 个知识项加入队列
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
                {/* Type Filter + Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-lg bg-gray-100/80 p-0.5 dark:bg-white/[0.06]">
                    {typeFilters.map((f) => {
                      const Icon = f.icon
                      return (
                        <button
                          key={f.key}
                          onClick={() => setManageFilter(f.key)}
                          className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                            manageFilter === f.key
                              ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-gray-100'
                              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                          }`}
                        >
                          <Icon size={12} />
                          {f.label}
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
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Upload size={13} />
                      上传文件
                    </button>
                    <button
                      onClick={() => setShowAddUrl(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Plus size={13} />
                      添加网址
                    </button>
                  </div>
                </div>

                {/* Add URL Modal */}
                {showAddUrl && (
                  <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                    <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">添加网址</h3>
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
                        placeholder="标题（可选）"
                        className="w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800"
                      />
                      <button
                        onClick={handleAddUrl}
                        disabled={addUrlMutation.isPending || !urlInput.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                      >
                        {addUrlMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        添加
                      </button>
                      <button
                        onClick={() => { setShowAddUrl(false); setUrlInput(''); setUrlTitle('') }}
                        className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        取消
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
                    <p className="mt-4 text-sm">暂无知识项</p>
                    <p className="mt-1 text-xs">上传文件、添加网址或创建笔记后自动生成</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {embeddingStatuses.map((item) => (
                      <div
                        key={item.id}
                        className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 transition-all hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                      >
                        {/* Type + Title */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {getTypeBadge(item.type)}
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                              {item.title || '无标题'}
                            </p>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                            {item.embeddingUpdatedAt
                              ? `更新于 ${safeFormatDate(item.embeddingUpdatedAt)}`
                              : '未索引'}
                          </p>
                        </div>

                        {/* Status badges */}
                        <div className="flex items-center gap-2">
                          {item.hasEmbedding ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              <CheckCircle2 size={10} />
                              已索引
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              <AlertCircle size={10} />
                              未索引
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
                              title="查看分块详情"
                            >
                              <Layers size={10} />
                              {item.chunkCount} 块
                            </button>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => generateMutation.mutate(item.id)}
                            disabled={generateMutation.isPending}
                            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 transition-all hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                          >
                            {generateMutation.isPending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            {item.hasEmbedding ? '重新索引' : '生成索引'}
                          </button>
                          {item.type !== 'note' && (
                            <button
                              onClick={() => {
                                if (confirm('确定删除该知识项？')) deleteMutation.mutate(item.id)
                              }}
                              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-400 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
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
                        <p className="mt-1 text-xs">尝试使用不同的关键词，或确保知识项已生成索引</p>
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
            <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-50">文档分块</h3>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{title}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {chunks.length} 块
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
              <p className="mt-4 text-sm">暂无分块数据</p>
              <p className="mt-1 text-xs">生成索引时会自动创建分块</p>
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
                          {chunk.chunkMethod === 'llm' ? 'LLM' : '结构化'}
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
                            <p className="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">摘要</p>
                            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{chunk.summary}</p>
                          </div>
                        )}
                        <div>
                          <p className="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">原始内容</p>
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
                            {chunk.content.length} 字符
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

/* ─── Status Card ─── */

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
  color: 'blue' | 'green' | 'amber' | 'purple' | 'indigo'
  loading: boolean
}) {
  const colorMap = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    indigo: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
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
