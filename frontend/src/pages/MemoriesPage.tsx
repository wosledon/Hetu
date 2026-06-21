import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Atom, Plus, Search, Trash2, Pencil, Save, X, Tag, Star, Brain } from 'lucide-react'
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

  const memories = searchQuery.trim() ? (searchResults ?? []) : (pagedData?.items ?? [])

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

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-8">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
                  <Atom size={20} className="text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">长期记忆</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    共 {pagedData?.totalCount ?? 0} 条记忆
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-600"
              >
                <Plus size={14} />
                新建记忆
              </button>
            </div>

            {/* Search */}
            <div className="relative mb-6">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="语义搜索记忆..."
                className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-teal-600 dark:focus:ring-teal-900/30"
              />
            </div>

            {/* Create form */}
            {isCreating && (
              <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50/50 p-4 dark:border-teal-800 dark:bg-teal-900/10">
                <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">新建记忆</h3>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="输入要记住的事实或偏好..."
                  rows={3}
                  className="mb-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-teal-600"
                />
                <div className="mb-3 flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">类别</label>
                    <input
                      type="text"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="如：偏好、身份、工作"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                  <div className="w-40">
                    <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
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
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setIsCreating(false); setNewContent(''); setNewCategory(''); setNewImportance(0.5) }}
                    className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newContent.trim() || createMutation.isPending}
                    className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
                  >
                    <Save size={14} />
                    保存
                  </button>
                </div>
              </div>
            )}

            {/* Memory list */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
              </div>
            ) : memories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Brain size={48} className="mb-4 opacity-30" />
                <p className="text-sm">
                  {searchQuery.trim() ? '没有找到匹配的记忆' : '还没有记忆，开始对话时会自动提取'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                  >
                    {editingId === memory.id ? (
                      /* Edit mode */
                      <div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="mb-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <div className="mb-3 flex gap-3">
                          <div className="flex-1">
                            <input
                              type="text"
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              placeholder="类别"
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                          <div className="w-40">
                            <label className="mb-1 block text-xs text-gray-500">重要性: {editImportance.toFixed(1)}</label>
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
                            className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleUpdate(memory.id)}
                            className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-sm text-white hover:bg-teal-600"
                          >
                            <Save size={14} />
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <div>
                        <p className="mb-2 text-sm text-gray-800 dark:text-gray-200">{memory.content}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
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
                            <span className="text-[11px] text-gray-400">
                              {memory.source === 'conversation' ? '对话提取' : '手动创建'}
                            </span>
                            {memory.score != null && (
                              <span className="text-[11px] text-teal-500">
                                相关度 {(memory.score * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <span className="mr-2 text-[11px] text-gray-400">
                              {formatTime(memory.lastAccessedAt)}
                            </span>
                            <button
                              onClick={() => startEdit(memory)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('确定删除这条记忆？')) deleteMutation.mutate(memory.id)
                              }}
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
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
    />
  )
}
