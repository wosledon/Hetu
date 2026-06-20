import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Download,
  Edit2,
  FileText,
  Hash,
  Import,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { promptPresetService } from '../services/promptPresetService'
import type { IPromptPreset } from '../types'

const CATEGORY_COLORS: Record<string, string> = {
  通用: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  写作: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  编程: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  自定义: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  导入: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const getCategoryColor = (category: string) =>
  CATEGORY_COLORS[category] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'

export default function AgentsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ category: '', name: '', content: '', variables: '' })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: presets = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
  })

  const createMutation = useMutation({
    mutationFn: promptPresetService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      closeForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { category: string; name: string; content: string; variables: string; sortOrder: number } }) =>
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

  // Category list with counts
  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of presets) {
      map.set(p.category, (map.get(p.category) || 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [presets])

  // Filtered presets
  const filteredPresets = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return presets.filter(p => {
      if (activeCategory && p.category !== activeCategory) return false
      if (keyword && !p.name.toLowerCase().includes(keyword) && !p.content.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [presets, search, activeCategory])

  // Extract {{variable}} patterns from content
  const extractedVars = useMemo(() => {
    const matches = form.content.match(/\{\{(\w+)\}\}/g)
    if (!matches) return []
    return [...new Set(matches.map(m => m.slice(2, -2)))]
  }, [form.content])

  const openCreateForm = () => {
    setEditingId(null)
    setForm({ category: '自定义', name: '', content: '', variables: '' })
    setShowForm(true)
  }

  const openEditForm = (preset: IPromptPreset) => {
    setEditingId(preset.id)
    setForm({
      category: preset.category,
      name: preset.name,
      content: preset.content,
      variables: preset.variables || '',
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ category: '', name: '', content: '', variables: '' })
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.content.trim()) return
    if (editingId) {
      const preset = presets.find(p => p.id === editingId)
      updateMutation.mutate({
        id: editingId,
        data: {
          category: form.category,
          name: form.name,
          content: form.content,
          variables: form.variables,
          sortOrder: preset?.sortOrder ?? 0,
        },
      })
    } else {
      createMutation.mutate({
        category: form.category,
        name: form.name,
        content: form.content,
        variables: form.variables,
      })
    }
  }

  const handleAutoExtractVars = () => {
    if (extractedVars.length > 0) {
      setForm({ ...form, variables: JSON.stringify(extractedVars) })
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
        if (Array.isArray(items)) {
          importMutation.mutate(items)
        }
      } catch { /* ignore */ }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const mainContent = (
    <div className="flex flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Left sidebar - categories */}
      <div className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">智能体</h2>
          <p className="mt-1 text-[10px] text-gray-400">管理提示词预设和智能体</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {/* All */}
          <button
            onClick={() => setActiveCategory(null)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              activeCategory === null
                ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'
            }`}
          >
            <span className="flex items-center gap-2">
              <Bot size={14} />
              全部
            </span>
            <span className="text-[10px] text-gray-400">{presets.length}</span>
          </button>

          {/* Category list */}
          {categories.map(([category, count]) => (
            <button
              key={category}
              onClick={() => setActiveCategory(activeCategory === category ? null : category)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                activeCategory === category
                  ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <Hash size={14} />
                {category}
              </span>
              <span className="text-[10px] text-gray-400">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索智能体..."
                className="h-8 w-56 rounded-lg border border-gray-200 bg-gray-50 py-1 pl-8 pr-3 text-xs outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-blue-600"
              />
            </div>
            {activeCategory && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(activeCategory)}`}>
                {activeCategory}
                <button onClick={() => setActiveCategory(null)} className="ml-0.5 opacity-60 hover:opacity-100">
                  <X size={10} />
                </button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="导出"
            >
              <Download size={13} />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="导入"
            >
              <Import size={13} />
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button
              onClick={openCreateForm}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus size={13} />
              新建智能体
            </button>
          </div>
        </div>

        {/* Cards grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredPresets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Sparkles size={36} className="mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-sm">暂无智能体</p>
              <button onClick={openCreateForm} className="mt-2 text-xs text-blue-500 hover:underline">
                创建第一个智能体
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
                >
                  {/* Built-in badge */}
                  {preset.isBuiltIn && (
                    <div className="absolute right-3 top-3">
                      <Lock size={12} className="text-gray-300 dark:text-gray-600" />
                    </div>
                  )}

                  {/* Icon + Name */}
                  <div className="mb-2 flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                      <Bot size={16} className="text-blue-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {preset.name}
                      </h3>
                      <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryColor(preset.category)}`}>
                        {preset.category}
                      </span>
                    </div>
                  </div>

                  {/* Content preview */}
                  <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    {preset.content}
                  </p>

                  {/* Variables */}
                  {preset.variables && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {(() => {
                        try {
                          const vars = JSON.parse(preset.variables) as string[]
                          return vars.map(v => (
                            <span key={v} className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                              <FileText size={9} />
                              {`{{${v}}}`}
                            </span>
                          ))
                        } catch { return null }
                      })()}
                    </div>
                  )}

                  {/* Actions */}
                  {!preset.isBuiltIn && (
                    <div className="flex items-center gap-1 border-t border-gray-100 pt-2 dark:border-gray-700">
                      <button
                        onClick={() => openEditForm(preset)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        <Edit2 size={11} />
                        编辑
                      </button>
                      <button
                        onClick={() => { if (confirm('确认删除该智能体？')) deleteMutation.mutate(preset.id) }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        <Trash2 size={11} />
                        删除
                      </button>
                    </div>
                  )}
                  {preset.isBuiltIn && (
                    <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
                      <span className="text-[10px] text-gray-300 dark:text-gray-600">内置智能体</span>
                    </div>
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
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Bot size={16} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {editingId ? '编辑智能体' : '新建智能体'}
                </h3>
              </div>
              <button
                onClick={closeForm}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">分类</label>
                  <input
                    type="text"
                    placeholder="如：通用、写作、编程"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-600 dark:bg-gray-700 dark:focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">名称</label>
                  <input
                    type="text"
                    placeholder="智能体名称"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-600 dark:bg-gray-700 dark:focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">提示词内容</label>
                <textarea
                  placeholder="输入系统提示词，支持 {{变量}} 占位符"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="h-40 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-600 dark:bg-gray-700 dark:focus:border-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder='变量，如 ["text"]'
                    value={form.variables}
                    onChange={(e) => setForm({ ...form, variables: e.target.value })}
                    className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-600 dark:bg-gray-700 dark:focus:border-blue-600"
                  />
                  {extractedVars.length > 0 && (
                    <button
                      onClick={handleAutoExtractVars}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                      title="从内容中自动提取变量"
                    >
                      <RefreshCw size={12} />
                      提取
                    </button>
                  )}
                </div>
                {extractedVars.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    检测到变量: {extractedVars.map(v => `{{${v}}}`).join(', ')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <button
                onClick={closeForm}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || !form.content.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId ? '保存修改' : '创建'}
              </button>
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
