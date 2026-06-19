import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  GitMerge,
  Hash,
  Pencil,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { tagService } from '../services/tagService'
import { useUIStore } from '../stores/uiStore'
import { tagPalette, TAG_COLOR_HEX } from '../utils/tagColor'
import type { ITag } from '../types'

interface ContextMenuState {
  x: number
  y: number
  tag: ITag
}

export default function TagsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSelectedTagId = useUIStore((s) => s.setSelectedTagId)
  const [search, setSearch] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameColor, setRenameColor] = useState<string>('')
  const [mergeSource, setMergeSource] = useState<ITag | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: tagService.getAll,
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color?: string }) => tagService.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; color?: string } }) =>
      tagService.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tagService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
    onError: (err: Error) => alert(err.message || '删除标签失败'),
  })

  const mergeMutation = useMutation({
    mutationFn: ({ sourceTagIds, targetTagId }: { sourceTagIds: string[]; targetTagId: string }) =>
      tagService.merge({ sourceTagIds, targetTagId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setMergeSource(null)
      setMergeTargetId('')
    },
    onError: (err: Error) => alert(err.message || '合并标签失败'),
  })

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (!menu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu()
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menu, closeMenu])

  const handleCreate = () => {
    const trimmed = newName.trim()
    if (trimmed) {
      createMutation.mutate({ name: trimmed, color: newColor || undefined })
    }
    setIsAdding(false)
    setNewName('')
    setNewColor('')
  }

  const handleRenameSubmit = (id: string) => {
    const trimmed = renameName.trim()
    if (trimmed) {
      updateMutation.mutate({ id, data: { name: trimmed, color: renameColor || undefined } })
    }
    setRenamingId(null)
  }

  const startRename = (tag: ITag) => {
    setRenamingId(tag.id)
    setRenameName(tag.name)
    setRenameColor(tag.color || '')
  }

  const startMerge = (tag: ITag) => {
    setMergeSource(tag)
    setMergeTargetId('')
  }

  const handleMergeConfirm = () => {
    if (!mergeSource || !mergeTargetId) return
    if (mergeTargetId === mergeSource.id) {
      alert('不能合并到自身')
      return
    }
    mergeMutation.mutate({ sourceTagIds: [mergeSource.id], targetTagId: mergeTargetId })
  }

  const handleDelete = (tag: ITag) => {
    if (confirm(`确定删除标签「${tag.name}」吗？相关笔记将不再关联此标签。`)) {
      deleteMutation.mutate(tag.id)
    }
  }

  const handleViewNotes = (tag: ITag) => {
    setSelectedTagId(tag.id)
    navigate('/')
  }

  const filteredTags = tags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  const mergeTargets = tags.filter((t) => t.id !== mergeSource?.id)

  return (
    <AppLayout showSidebar={false} mainContent={null}>
      <div className="flex w-full flex-col bg-gray-50 dark:bg-gray-950">
        {/* 顶栏 */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
              title="返回笔记"
            >
              <ArrowLeft size={18} />
            </button>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-gray-100">
              <TagIcon size={20} className="text-blue-500" />
              标签管理
            </h1>
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-600"
          >
            <Plus size={15} />
            新建标签
          </button>
        </header>

        {/* 工具栏：搜索 + 统计 */}
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="relative max-w-sm flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标签..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:bg-gray-800 dark:focus:ring-blue-950/40"
            />
          </div>
          <div className="flex shrink-0 items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>
              共 <span className="font-semibold text-gray-700 dark:text-gray-200">{tags.length}</span> 个标签
            </span>
            <span className="hidden sm:inline">
              关联 <span className="font-semibold text-gray-700 dark:text-gray-200">{tags.reduce((s, t) => s + (t.noteCount ?? 0), 0)}</span> 篇笔记
            </span>
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {isAdding && (
            <div className="mb-5 overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm dark:border-blue-900/50 dark:bg-gray-900">
              <div className="flex items-center gap-2 border-b border-gray-100 bg-blue-50/60 px-4 py-2.5 dark:border-gray-800 dark:bg-blue-950/20">
                <Plus size={15} className="text-blue-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">新建标签</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 p-4">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') { setIsAdding(false); setNewName(''); setNewColor('') }
                  }}
                  placeholder="输入标签名称"
                  className="min-w-[200px] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-blue-950/40"
                />
                <ColorPicker value={newColor} onChange={setNewColor} />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreate}
                    className="flex items-center gap-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                  >
                    <Check size={15} />
                    创建
                  </button>
                  <button
                    onClick={() => { setIsAdding(false); setNewName(''); setNewColor('') }}
                    className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}

          {filteredTags.length === 0 && !isAdding ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400 dark:text-gray-600">
              <div className="mb-4 rounded-full bg-gray-100 p-5 dark:bg-gray-800">
                <TagIcon size={32} className="opacity-60" />
              </div>
              <p className="text-sm">{search ? '没有匹配的标签' : '暂无标签，点击右上角新建'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredTags.map((tag) => {
                const isRenaming = renamingId === tag.id
                const palette = tagPalette(tag)
                const noteCount = tag.noteCount ?? 0
                return (
                  <div
                    key={tag.id}
                    className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, tag })
                    }}
                  >
                    {/* 左侧色条 */}
                    <div
                      className="absolute inset-y-0 left-0 w-1"
                      style={{ background: palette.dot }}
                    />
                    {isRenaming ? (
                      <div className="p-4 pl-5">
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={renameName}
                            onChange={(e) => setRenameName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameSubmit(tag.id)
                              if (e.key === 'Escape') setRenamingId(null)
                            }}
                            className="min-w-0 flex-1 rounded-md border border-blue-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-100 dark:border-blue-700 dark:bg-gray-800 dark:focus:ring-blue-950/40"
                          />
                          <button
                            onClick={() => handleRenameSubmit(tag.id)}
                            className="rounded-md bg-blue-500 p-1.5 text-white hover:bg-blue-600"
                            title="保存"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                            title="取消"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <div className="mt-3">
                          <ColorPicker value={renameColor} onChange={setRenameColor} compact />
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleViewNotes(tag)}
                        className="flex w-full items-center gap-3 p-4 pl-5 text-left"
                        title="查看该标签下的笔记"
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: palette.soft, color: palette.text }}
                        >
                          <Hash size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                            {tag.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-gray-400 dark:text-gray-500">
                            {noteCount} 篇笔记
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 合并对话框 */}
        {mergeSource && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <GitMerge size={18} className="text-blue-500" />
                  <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">合并标签</h3>
                </div>
                <button
                  onClick={() => { setMergeSource(null); setMergeTargetId('') }}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 py-4">
                <p className="mb-4 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  将标签{' '}
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: tagPalette(mergeSource).soft, color: tagPalette(mergeSource).text }}>
                    #{mergeSource.name}
                  </span>
                  {' '}合并到目标标签，合并后原标签将被删除，相关笔记改用目标标签。
                </p>
                <select
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-blue-950/40"
                >
                  <option value="">选择目标标签</option>
                  {mergeTargets.map((t) => (
                    <option key={t.id} value={t.id}>#{t.name}（{t.noteCount ?? 0} 篇）</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
                <button
                  onClick={() => { setMergeSource(null); setMergeTargetId('') }}
                  className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  取消
                </button>
                <button
                  onClick={handleMergeConfirm}
                  disabled={!mergeTargetId || mergeMutation.isPending}
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mergeMutation.isPending ? '合并中...' : '确认合并'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 右键菜单 */}
        {menu && createPortal(
          <div
            ref={menuRef}
            className="fixed min-w-[168px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
            style={{
              left: Math.min(menu.x, window.innerWidth - 188),
              top: Math.min(menu.y, window.innerHeight - 220),
              zIndex: 50,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { closeMenu(); handleViewNotes(menu.tag) }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Hash size={14} className="text-gray-400" />
              查看笔记
            </button>
            <button
              onClick={() => { closeMenu(); startRename(menu.tag) }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Pencil size={14} className="text-gray-400" />
              重命名
            </button>
            <button
              onClick={() => { closeMenu(); startMerge(menu.tag) }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <GitMerge size={14} className="text-gray-400" />
              合并到...
            </button>
            <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
            <button
              onClick={() => { closeMenu(); handleDelete(menu.tag) }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>,
          document.body
        )}
      </div>
    </AppLayout>
  )
}

function ColorPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string
  onChange: (v: string) => void
  compact?: boolean
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? '' : 'min-w-[200px]'}`}>
      <button
        onClick={() => onChange('')}
        className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all ${
          value === ''
            ? 'border-gray-700 dark:border-white'
            : 'border-gray-200 dark:border-gray-600'
        } bg-gray-200 dark:bg-gray-600`}
        title="自动配色"
      >
        {value === '' && <Check size={12} className="text-gray-700 dark:text-white" />}
      </button>
      {Object.entries(TAG_COLOR_HEX).map(([name, hex]) => (
        <button
          key={name}
          onClick={() => onChange(name)}
          className={`h-6 w-6 rounded-full border-2 transition-all hover:scale-110 ${
            value === name ? 'border-gray-700 dark:border-white' : 'border-transparent'
          }`}
          style={{ background: hex.dot }}
          title={name}
        />
      ))}
    </div>
  )
}
