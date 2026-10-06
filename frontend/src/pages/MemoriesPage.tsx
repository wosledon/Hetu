import { confirm } from '../components/confirm'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Atom, Plus, Search, Trash2, Pencil, Save, Tag, Star, Brain, X } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { memoryService } from '../services/memoryService'
import type { IMemory } from '../types'

const CATEGORY_COLORS: Record<string, string> = {
  '偏好': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  '身份': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  '工作': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  '习惯': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  '知识': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
}

function getCategoryColor(category?: string): string {
  if (!category) return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  return CATEGORY_COLORS[category] || 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 30) return `${diffDays} 天前`
  return date.toLocaleDateString('zh-CN')
}

function importanceToStars(importance: number): number {
  if (importance >= 0.9) return 5
  if (importance >= 0.7) return 4
  if (importance >= 0.5) return 3
  if (importance >= 0.3) return 2
  return 1
}

export default function MemoriesPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newImportance, setNewImportance] = useState(0.5)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editImportance, setEditImportance] = useState(0.5)

  const { data: pagedData, isLoading } = useQuery({
    queryKey: ['memories'],
    queryFn: () => memoryService.getAll(1, 200),
  })

  const { data: searchResults } = useQuery({
    queryKey: ['memories', 'search', searchQuery],
    queryFn: () => memoryService.search(searchQuery, 20),
    enabled: searchQuery.trim().length > 0,
  })

  const createMutation = useMutation({
    mutationFn: memoryService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      setIsCreating(false)
      setNewContent('')
      setNewCategory('')
      setNewImportance(0.5)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { content: string; category?: string; importance: number } }) =>
      memoryService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      setEditingId(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: memoryService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
  })

  const allMemories = searchQuery.trim() ? (searchResults ?? []) : (pagedData?.items ?? [])

  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of pagedData?.items ?? []) {
      const key = m.category || '未分类'
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [pagedData])

  const memories = activeCategory
    ? allMemories.filter((m) => (m.category || '未分类') === activeCategory)
    : allMemories

  const handleCreate = () => {
    if (!newContent.trim()) return
    createMutation.mutate({
      content: newContent.trim(),
      category: newCategory.trim() || undefined,
      importance: newImportance,
    })
  }

  const handleUpdate = (id: string) => {
    if (!editContent.trim()) return
    updateMutation.mutate({
      id,
      data: { content: editContent.trim(), category: editCategory.trim() || undefined, importance: editImportance },
    })
  }

  const startEdit = (memory: IMemory) => {
    setEditingId(memory.id)
    setEditContent(memory.content)
    setEditCategory(memory.category || '')
    setEditImportance(memory.importance)
  }

  const filterPill = (active: boolean) =>
    active
      ? 'bg-teal-500 text-white shadow-sm shadow-teal-500/20'
      : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-8 py-8">
            {/* 页头 */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-sm shadow-teal-500/20">
                  <Atom size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">长期记忆</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">AI 在对话中自动提取的事实与偏好，可手动修正</p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{pagedData?.totalCount ?? 0}</b> 条记忆</span>
                {categories.length > 0 && (
                  <>
                    <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                    <span><b className="text-sm font-semibold text-teal-600 dark:text-teal-400">{categories.length}</b> 个类别</span>
                  </>
                )}
              </div>
            </div>

            {/* 工具栏：分类筛选 + 搜索 + 新建 */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setActiveCategory(null)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === null)}`}
                >
                  全部
                  <span className="text-[11px] opacity-70">{pagedData?.totalCount ?? 0}</span>
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
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="语义搜索记忆..."
                  className="w-full rounded-full border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:ring-teal-950/40"
                />
              </div>
              <button
                onClick={() => setIsCreating(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-teal-500/20 transition-all hover:shadow-md active:scale-[0.97]"
              >
                <Plus size={16} />
                新建记忆
              </button>
            </div>

            {/* 记忆列表 */}
            {isLoading ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
              </div>
            ) : memories.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
                  <Brain size={36} className="opacity-50" />
                </div>
                <p className="text-sm font-medium">
                  {searchQuery.trim() ? '没有找到匹配的记忆' : activeCategory ? '该类别下暂无记忆' : '还没有记忆，开始对话时会自动提取'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="group rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                  >
                    {editingId === memory.id ? (
                      /* 编辑模式 */
                      <div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="mb-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-teal-950/40"
                        />
                        <div className="mb-3 flex flex-wrap gap-3">
                          <div className="min-w-[160px] flex-1">
                            <input
                              type="text"
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              placeholder="类别"
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                          <div className="w-40">
                            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">重要性: {editImportance.toFixed(1)}</label>
                            <input
                              type="range"
                              min={0.1}
                              max={1}
                              step={0.1}
                              value={editImportance}
                              onChange={(e) => setEditImportance(parseFloat(e.target.value))}
                              className="w-full accent-teal-500"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-xl px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleUpdate(memory.id)}
                            className="flex items-center gap-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm shadow-teal-500/20 transition-all hover:shadow-md"
                          >
                            <Save size={14} />
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* 查看模式 */
                      <div>
                        <p className="mb-2.5 text-sm leading-relaxed text-gray-800 dark:text-gray-200">{memory.content}</p>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {memory.category && (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${getCategoryColor(memory.category)}`}>
                                <Tag size={10} />
                                {memory.category}
                              </span>
                            )}
                            <span className="flex items-center gap-0.5">
                              {Array.from({ length: importanceToStars(memory.importance) }).map((_, i) => (
                                <Star key={i} size={10} className="fill-amber-400 text-amber-400" />
                              ))}
                              {Array.from({ length: 5 - importanceToStars(memory.importance) }).map((_, i) => (
                                <Star key={i} size={10} className="text-gray-300 dark:text-gray-600" />
                              ))}
                            </span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                              {memory.source === 'conversation' ? '对话提取' : '手动创建'}
                            </span>
                            {memory.score != null && (
                              <span className="text-[11px] text-teal-500">相关度 {(memory.score * 100).toFixed(0)}%</span>
                            )}
                            <span className="text-[11px] text-gray-300 dark:text-gray-600">{formatTime(memory.lastAccessedAt)}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <button
                              onClick={() => startEdit(memory)}
                              className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
                              title="编辑"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => {
                                confirm({ message: '确定删除这条记忆？', onConfirm: () => deleteMutation.mutate(memory.id) })
                              }}
                              className="rounded-full p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      }
    >
      {/* 新建记忆对话框 */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsCreating(false)}>
          <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Atom size={18} className="text-teal-500" />
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">新建记忆</h3>
              </div>
              <button onClick={() => setIsCreating(false)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">内容</label>
                <textarea
                  autoFocus
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="输入要记住的事实或偏好..."
                  rows={4}
                  className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-teal-950/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">类别</label>
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="如：偏好、身份、工作"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-teal-950/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  重要性: {newImportance.toFixed(1)}
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.1}
                  value={newImportance}
                  onChange={(e) => setNewImportance(parseFloat(e.target.value))}
                  className="w-full accent-teal-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => setIsCreating(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!newContent.trim() || createMutation.isPending}
                className="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-teal-500/20 transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createMutation.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
