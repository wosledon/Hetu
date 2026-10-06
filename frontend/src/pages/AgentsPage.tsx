import { confirm } from '../components/confirm'
import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  BookOpen,
  Brain,
  CalendarClock,
  ClipboardList,
  Download,
  Edit2,
  FileEdit,
  FolderOpen,
  FolderSearch,
  Globe,
  HelpCircle,
  Import,
  Loader2,
  Lock,
  Network,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import FolderPickerDialog from '../components/FolderPickerDialog'
import Select from '../components/Select'
import { promptPresetService } from '../services/promptPresetService'
import type { ILocalPromptPreset } from '../types'
import type { IPromptPreset } from '../types'

type TabKey = 'database' | 'local'

const CATEGORY_COLORS: Record<string, string> = {
  通用: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  写作: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  编程: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  分析: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  创意: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  自定义: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  导入: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  本地: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const getCategoryColor = (category: string) =>
  CATEGORY_COLORS[category] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'

const TOOL_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  search_notes: Search,
  read_note: BookOpen,
  search_web: Globe,
  search_memory: Brain,
  search_graph: Network,
  create_note: PenLine,
  update_note: FileEdit,
  create_memory: Save,
  ask_question: HelpCircle,
  todo: ClipboardList,
  run_command: Zap,
  create_scheduled_task: CalendarClock,
}

const renderToolIcon = (name: string, className = 'text-gray-500') => {
  const Icon = TOOL_ICON_MAP[name]
  return Icon ? <Icon size={14} className={className} /> : <Sparkles size={14} className={className} />
}

const AVAILABLE_TOOLS = [
  { name: 'search_notes', label: '搜索笔记', category: '检索' },
  { name: 'read_note', label: '读取笔记', category: '检索' },
  { name: 'search_web', label: '网络搜索', category: '检索' },
  { name: 'search_memory', label: '搜索记忆', category: '检索' },
  { name: 'search_graph', label: '搜索图谱', category: '检索' },
  { name: 'create_note', label: '创建笔记', category: '写入' },
  { name: 'update_note', label: '更新笔记', category: '写入' },
  { name: 'create_memory', label: '保存记忆', category: '写入' },
  { name: 'ask_question', label: '向用户提问', category: '交互' },
  { name: 'todo', label: '任务管理', category: '交互' },
  { name: 'create_scheduled_task', label: '创建定时任务', category: '执行' },
  { name: 'run_command', label: '执行命令', category: '执行' },
] as const

export default function AgentsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('database')
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ category: '', name: '', content: '' })
  const [enabledTools, setEnabledTools] = useState<string[]>(AVAILABLE_TOOLS.map(t => t.name))
  const [toolApprovals, setToolApprovals] = useState<Record<string, string>>({})
  const [showDirConfig, setShowDirConfig] = useState(false)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Database presets
  const { data: dbPresets = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
  })
  // Local presets
  const { data: localPresets = [], isLoading: localLoading, refetch: refetchLocal } = useQuery({
    queryKey: ['localPromptPresets'],
    queryFn: () => promptPresetService.getLocal(),
    enabled: tab === 'local',
  })
  // Directories
  const { data: directories = [] } = useQuery({
    queryKey: ['promptPresetDirectories'],
    queryFn: () => promptPresetService.getDirectories(),
    enabled: showDirConfig,
  })

  const createMutation = useMutation({
    mutationFn: (data: { category: string; name: string; content: string; toolsConfig: string }) =>
      promptPresetService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      closeForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { category: string; name: string; content: string; sortOrder: number; toolsConfig: string } }) =>
      promptPresetService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      closeForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: promptPresetService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresets'] }),
  })

  const importMutation = useMutation({
    mutationFn: promptPresetService.import,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresets'] }),
  })

  const updateDirsMutation = useMutation({
    mutationFn: (dirs: string[]) => promptPresetService.updateDirectories(dirs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresetDirectories'] }),
  })

  const presets = tab === 'database' ? dbPresets : localPresets

  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of presets) map.set(p.category, (map.get(p.category) || 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [presets])

  const filteredPresets = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return presets.filter(p => {
      if (activeCategory && p.category !== activeCategory) return false
      if (keyword && !p.name.toLowerCase().includes(keyword) && !p.content.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [presets, search, activeCategory])

  const openCreateForm = () => { setEditingId(null); setForm({ category: '自定义', name: '', content: '' }); setEnabledTools(AVAILABLE_TOOLS.map(t => t.name)); setToolApprovals({}); setShowForm(true) }
  const openEditForm = (preset: IPromptPreset) => {
    setEditingId(preset.id)
    setForm({ category: preset.category, name: preset.name, content: preset.content })
    try {
      const config = preset.toolsConfig ? JSON.parse(preset.toolsConfig) : {}
      setEnabledTools(config.tools || AVAILABLE_TOOLS.map(t => t.name))
      setToolApprovals(config.toolApprovals || {})
    } catch {
      setEnabledTools(AVAILABLE_TOOLS.map(t => t.name))
      setToolApprovals({})
    }
    setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm({ category: '', name: '', content: '' }); setEnabledTools(AVAILABLE_TOOLS.map(t => t.name)); setToolApprovals({}) }

  const handleSave = () => {
    if (!form.name.trim() || !form.content.trim()) return
    const toolsConfigJson = JSON.stringify({ tools: enabledTools, toolApprovals })
    if (editingId) {
      const preset = dbPresets.find(p => p.id === editingId)
      updateMutation.mutate({ id: editingId, data: { ...form, sortOrder: preset?.sortOrder ?? 0, toolsConfig: toolsConfigJson } })
    } else {
      createMutation.mutate({ ...form, toolsConfig: toolsConfigJson })
    }
  }

  const handleExport = async () => {
    const data = await promptPresetService.export()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'agents.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const items = JSON.parse(reader.result as string)
        if (Array.isArray(items)) importMutation.mutate(items)
      } catch { /* ignore */ }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleAddDir = () => {
    const trimmed = dirInput.trim()
    if (!trimmed || directories.includes(trimmed)) return
    updateDirsMutation.mutate([...directories, trimmed])
    setDirInput('')
  }

  const handleRemoveDir = (dir: string) => {
    updateDirsMutation.mutate(directories.filter(d => d !== dir))
  }

  // 打开前端目录选择器；选中后直接添加
  const handleBrowseDir = () => setShowFolderPicker(true)

  const handleFolderPicked = (picked: string) => {
    setShowFolderPicker(false)
    const trimmed = picked.trim()
    if (!trimmed || directories.includes(trimmed)) return
    updateDirsMutation.mutate([...directories, trimmed])
    setDirInput('')
  }

  const getToolCount = (toolsConfig?: string) => {
    if (!toolsConfig) return AVAILABLE_TOOLS.length
    try {
      const config = JSON.parse(toolsConfig)
      return config.tools?.length ?? AVAILABLE_TOOLS.length
    } catch {
      return AVAILABLE_TOOLS.length
    }
  }

  const renderPresetCard = (preset: IPromptPreset | ILocalPromptPreset, isLocal: boolean) => {
    const p = preset
    const toolCount = getToolCount(p.toolsConfig)
    return (
      <div
        key={p.id}
        className="group relative flex flex-col rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
      >
        <div className="mb-2 flex items-start justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-900/20">
              {isLocal ? <Terminal size={16} className="text-rose-500" /> : <Bot size={16} className="text-rose-500" />}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{p.name}</h3>
              <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(p.category)}`}>{p.category}</span>
            </div>
          </div>
          {!isLocal && (p as IPromptPreset).isBuiltIn && (
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400 dark:bg-white/[0.06]">内置</span>
          )}
          {isLocal && (
            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-900/30">本地</span>
          )}
        </div>

        <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{p.content}</p>

        {toolCount > 0 && (
          <div className="mb-1 flex items-center gap-1 text-[10px] text-gray-400">
            <Zap size={11} />
            <span>{toolCount} 个工具</span>
          </div>
        )}

        {!isLocal && !(p as IPromptPreset).isBuiltIn && (
          <div className="flex items-center gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <button onClick={() => openEditForm(p as IPromptPreset)} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"><Edit2 size={11} /> 编辑</button>
            <button onClick={() => { confirm({ message: '确认删除？', onConfirm: () => deleteMutation.mutate(p.id) }) }} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"><Trash2 size={11} /> 删除</button>
          </div>
        )}
        {!isLocal && (p as IPromptPreset).isBuiltIn && (
          <div className="flex items-center gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <Lock size={11} className="text-gray-300 dark:text-gray-600" />
            <span className="text-[10px] text-gray-300 dark:text-gray-600">内置智能体</span>
          </div>
        )}
        {isLocal && (
          <div className="border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <span className="truncate text-[10px] text-gray-300 dark:text-gray-600" title={(p as ILocalPromptPreset).filePath}>
              {(p as ILocalPromptPreset).filePath}
            </span>
          </div>
        )}
      </div>
    )
  }

  const filterPill = (active: boolean) =>
    active
      ? 'bg-rose-500 text-white shadow-sm shadow-rose-500/20'
      : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'

  const mainContent = (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl px-8 py-8">
        {/* 页头 */}
        <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-sm shadow-rose-500/20">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">智能体</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">管理系统提示词预设，为不同场景分配专属智能体</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{presets.length}</b> 个智能体</span>
            <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
            <span><b className="text-sm font-semibold text-rose-600 dark:text-rose-400">{categories.length}</b> 个分类</span>
          </div>
        </div>

        {/* 选项卡 */}
        <div className="mb-4 flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
          {([
            { key: 'database' as TabKey, label: '数据库', icon: Bot },
            { key: 'local' as TabKey, label: '本地', icon: FolderOpen },
          ]).map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setActiveCategory(null); if (t.key === 'local') refetchLocal() }}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${
                  tab === t.key
                    ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* 工具栏：分类筛选 + 搜索 + 操作 */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === null)}`}
            >
              全部
              <span className="text-[11px] opacity-70">{presets.length}</span>
            </button>
            {categories.map(([cat, count]) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === cat)}`}
              >
                {cat}
                <span className="text-[11px] opacity-70">{count}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[180px] max-w-xs flex-1">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索智能体..."
              className="w-full rounded-full border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:ring-rose-950/40"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          {tab === 'local' ? (
            <>
              <button
                onClick={() => setShowDirConfig(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Settings size={14} />
                配置目录
              </button>
              <button
                onClick={() => refetchLocal()}
                title="刷新本地智能体"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleExport}
                title="导出"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Download size={14} />
                导出
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="导入"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Import size={14} />
                导入
              </button>
              <button
                onClick={openCreateForm}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-rose-500 to-pink-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-rose-500/20 transition-all hover:shadow-md active:scale-[0.97]"
              >
                <Plus size={16} />
                新建智能体
              </button>
            </>
          )}
        </div>

        {/* 卡片网格 */}
        {tab === 'local' && localLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800">
            <Loader2 size={32} className="mb-3 animate-spin text-rose-400" />
            <p className="text-sm">正在扫描本地智能体...</p>
          </div>
        ) : filteredPresets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
              <Sparkles size={36} className="opacity-50" />
            </div>
            <p className="text-sm font-medium">{tab === 'local' ? '未发现本地智能体' : '暂无智能体'}</p>
            {tab === 'local' ? (
              <button onClick={() => setShowDirConfig(true)} className="mt-2 text-xs text-rose-500 hover:underline">
                配置智能体目录
              </button>
            ) : (
              <button onClick={openCreateForm} className="mt-2 text-xs text-rose-500 hover:underline">
                创建第一个智能体
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredPresets.map(p => renderPresetCard(p, tab === 'local'))}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <AppLayout showSidebar={false} mainContent={mainContent}>
      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30"><Bot size={16} className="text-rose-600 dark:text-rose-400" /></div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{editingId ? '编辑智能体' : '新建智能体'}</h3>
              </div>
              <button onClick={closeForm} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">分类</label>
                  <input type="text" placeholder="如：通用、编程、创意" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">名称</label>
                  <input type="text" placeholder="智能体名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">System Prompt</label>
                <textarea placeholder="定义智能体的角色和行为规则..." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="h-48 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                <p className="mt-1 text-[10px] text-gray-400">定义智能体的角色、能力和行为准则。对话时将作为系统提示词使用。</p>
              </div>
              {/* Tool Configuration */}
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-400">可用工具</label>
                <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                  {Object.entries(
                    AVAILABLE_TOOLS.reduce((acc, tool) => {
                      (acc[tool.category] ??= []).push(tool)
                      return acc
                    }, {} as Record<string, typeof AVAILABLE_TOOLS[number][]>)
                  ).map(([category, tools]) => (
                    <div key={category}>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">{category}</div>
                      <div className="space-y-1">
                        {tools.map(tool => {
                          const isEnabled = enabledTools.includes(tool.name)
                          const approval = toolApprovals[tool.name] || 'auto'
                          return (
                            <div key={tool.name} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-white dark:hover:bg-gray-700/50">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={(e) => {
                                    if (e.target.checked) setEnabledTools(prev => [...prev, tool.name])
                                    else setEnabledTools(prev => prev.filter(n => n !== tool.name))
                                  }}
                                  className="rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                                />
                                <span className="text-xs">{renderToolIcon(tool.name)}</span>
                                <span className="text-xs text-gray-700 dark:text-gray-300">{tool.label}</span>
                              </label>
                              {isEnabled && (
                                <Select
                                  value={approval}
                                  onChange={(value) => setToolApprovals(prev => ({ ...prev, [tool.name]: value }))}
                                  options={[
                                    { value: 'bypass', label: '静默' },
                                    { value: 'auto', label: '自动' },
                                    { value: 'ask', label: '询问' },
                                  ]}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <button onClick={closeForm} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">取消</button>
              <button onClick={handleSave} disabled={!form.name.trim() || !form.content.trim()} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50">{editingId ? '保存' : '创建'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Directory config modal */}
      {showDirConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <FolderOpen size={16} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">配置智能体目录</h3>
                  <p className="text-xs text-gray-500">点击「浏览」选择目录，或手动输入路径</p>
                </div>
              </div>
              <button onClick={() => setShowDirConfig(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="flex gap-2">
                <button
                  onClick={handleBrowseDir}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600"
                >
                  <FolderSearch size={14} />
                  浏览
                </button>
                <input
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddDir() }}
                  placeholder="或手动输入目录路径，如 /home/user/agents"
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                />
                <button onClick={handleAddDir} disabled={!dirInput.trim()} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
                  添加
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {directories.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400">
                    <AlertCircle size={16} className="mx-auto mb-1" />
                    暂未配置智能体目录
                  </div>
                ) : (
                  directories.map(dir => (
                    <div key={dir} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                      <span className="truncate text-xs text-gray-700 dark:text-gray-300" title={dir}>{dir}</span>
                      <button onClick={() => handleRemoveDir(dir)} className="ml-2 shrink-0 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-900/20">
                <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
                  目录结构：每个子文件夹包含一个 <code className="rounded bg-rose-100 px-1 dark:bg-rose-800">agent.json</code> 或 <code className="rounded bg-rose-100 px-1 dark:bg-rose-800">AGENT.md</code> 文件。
                  也支持根目录下的 <code className="rounded bg-rose-100 px-1 dark:bg-rose-800">.json</code> 文件。
                </p>
              </div>
            </div>
            <div className="flex justify-end border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <button onClick={() => setShowDirConfig(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 前端目录选择器 */}
      {showFolderPicker && (
        <FolderPickerDialog
          initialPath={dirInput.trim() || directories[directories.length - 1]}
          title="选择智能体目录"
          onClose={() => setShowFolderPicker(false)}
          onPick={handleFolderPicked}
        />
      )}

    </AppLayout>
  )
}
