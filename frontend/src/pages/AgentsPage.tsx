import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Download,
  Edit2,
  Hash,
  Import,
  Lock,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
  BookOpen,
  Globe,
  Brain,
  Network,
  PenLine,
  FileEdit,
  Save,
  HelpCircle,
  ClipboardList,
  Zap,
  CalendarClock,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import { promptPresetService } from '../services/promptPresetService'
import type { IPromptPreset } from '../types'

const CATEGORY_COLORS: Record<string, string> = {
  通用: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  写作: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  编程: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  分析: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  创意: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  自定义: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  导入: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
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

const TOOL_APPROVAL_LABELS: Record<string, string> = {
  bypass: '静默',
  auto: '自动',
  ask: '询问',
}

export default function AgentsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ category: '', name: '', content: '' })
  const [enabledTools, setEnabledTools] = useState<string[]>(AVAILABLE_TOOLS.map(t => t.name))
  const [toolApprovals, setToolApprovals] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: presets = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
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
      const preset = presets.find(p => p.id === editingId)
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

  const mainContent = (
    <div className="flex flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Left sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">智能体</h2>
          <p className="mt-1 text-[10px] text-gray-400">管理 AI 智能体（System Prompt）</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => setActiveCategory(null)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${activeCategory === null ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'}`}
          >
            <span className="flex items-center gap-2"><Bot size={14} /> 全部</span>
            <span className="text-[10px] text-gray-400">{presets.length}</span>
          </button>
          {categories.map(([category, count]) => (
            <button
              key={category}
              onClick={() => setActiveCategory(activeCategory === category ? null : category)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${activeCategory === category ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'}`}
            >
              <span className="flex items-center gap-2"><Hash size={14} /> {category}</span>
              <span className="text-[10px] text-gray-400">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索智能体..." className="h-8 w-56 rounded-lg border border-gray-200 bg-gray-50 py-1 pl-8 pr-3 text-xs outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800" />
            </div>
            {activeCategory && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(activeCategory)}`}>
                {activeCategory}
                <button onClick={() => setActiveCategory(null)} className="ml-0.5 opacity-60 hover:opacity-100"><X size={10} /></button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleExport} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800" title="导出"><Download size={13} /></button>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800" title="导入"><Import size={13} /></button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button onClick={openCreateForm} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"><Plus size={13} /> 新建智能体</button>
          </div>
        </div>

        {/* Cards grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredPresets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Sparkles size={36} className="mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-sm">暂无智能体</p>
              <button onClick={openCreateForm} className="mt-2 text-xs text-blue-500 hover:underline">创建第一个智能体</button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredPresets.map((preset) => (
                <div key={preset.id} className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600">
                  {preset.isBuiltIn && (
                    <div className="absolute right-3 top-3"><Lock size={12} className="text-gray-300 dark:text-gray-600" /></div>
                  )}
                  <div className="mb-2 flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                      <Bot size={16} className="text-blue-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{preset.name}</h3>
                      <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryColor(preset.category)}`}>{preset.category}</span>
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{preset.content}</p>
                  {(() => {
                    try {
                      const config = preset.toolsConfig ? JSON.parse(preset.toolsConfig) : {}
                      const toolCount = config.tools?.length ?? AVAILABLE_TOOLS.length
                      return toolCount > 0 ? (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-400">
                          <span>⚡</span>
                          <span>{toolCount} 个工具</span>
                        </div>
                      ) : null
                    } catch { return null }
                  })()}
                  {!preset.isBuiltIn && (
                    <div className="flex items-center gap-1 border-t border-gray-100 pt-2 dark:border-gray-700">
                      <button onClick={() => openEditForm(preset)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"><Edit2 size={11} /> 编辑</button>
                      <button onClick={() => { if (confirm('确认删除？')) deleteMutation.mutate(preset.id) }} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20"><Trash2 size={11} /> 删除</button>
                    </div>
                  )}
                  {preset.isBuiltIn && (
                    <div className="border-t border-gray-100 pt-2 dark:border-gray-700"><span className="text-[10px] text-gray-300 dark:text-gray-600">内置智能体</span></div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30"><Bot size={16} className="text-blue-600 dark:text-blue-400" /></div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{editingId ? '编辑智能体' : '新建智能体'}</h3>
              </div>
              <button onClick={closeForm} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">分类</label>
                  <input type="text" placeholder="如：通用、编程、创意" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">名称</label>
                  <input type="text" placeholder="智能体名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">System Prompt</label>
                <textarea placeholder="定义智能体的角色和行为规则..." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="h-48 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
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
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
              <button onClick={handleSave} disabled={!form.name.trim() || !form.content.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{editingId ? '保存' : '创建'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <AppLayout showSidebar={false} mainContent={mainContent}>
      {null}
    </AppLayout>
  )
}
