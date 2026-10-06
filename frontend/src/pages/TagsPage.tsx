import { confirm } from '../components/confirm'
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Check,
  GitMerge,
  Pencil,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import { tagService } from '../services/tagService'
import { useDismissOnOutside } from '../hooks/useDismissOnOutside'
import { useUIStore } from '../stores/uiStore'
import { tagPalette, TAG_COLOR_HEX } from '../utils/tagColor'
import type { ITag } from '../types'

interface ContextMenuState {
  x: number
  y: number
  tag: ITag
}

type FilterKey = 'all' | 'used' | 'unused'

type EditState =
  | { mode: 'create' }
  | { mode: 'rename'; tag: ITag }
  | null

export default function TagsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSelectedTagId = useUIStore((s) => s.setSelectedTagId)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [edit, setEdit] = useState<EditState>(null)
  const [mergeSource, setMergeSource] = useState<ITag | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: tagService.getAll,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tags'] })
    queryClient.invalidateQueries({ queryKey: ['notes'] })
  }

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color?: string }) => tagService.create(data),
    onSuccess: invalidate,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; color?: string } }) =>
      tagService.update(id, data),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tagService.delete(id),
    onSuccess: invalidate,
    onError: (err: Error) => alert(err.message || '删除标签失败'),
  })

  const mergeMutation = useMutation({
    mutationFn: ({ sourceTagIds, targetTagId }: { sourceTagIds: string[]; targetTagId: string }) =>
      tagService.merge({ sourceTagIds, targetTagId }),
    onSuccess: () => {
      invalidate()
      setMergeSource(null)
      setMergeTargetId('')
    },
    onError: (err: Error) => alert(err.message || '合并标签失败'),
  })

  const closeMenu = useCallback(() => setMenu(null), [])

  useDismissOnOutside(menu !== null, closeMenu, [menuRef])

  const handleMergeConfirm = () => {
    if (!mergeSource || !mergeTargetId) return
    if (mergeTargetId === mergeSource.id) {
      alert('不能合并到自身')
      return
    }
    mergeMutation.mutate({ sourceTagIds: [mergeSource.id], targetTagId: mergeTargetId })
  }

  const handleDelete = (tag: ITag) => {
    confirm({ message: `确定删除标签「${tag.name}」吗？相关笔记将不再关联此标签。`, onConfirm: () => deleteMutation.mutate(tag.id) })
  }

  const handleViewNotes = (tag: ITag) => {
    setSelectedTagId(tag.id)
    navigate('/')
  }

  const usedCount = tags.filter((t) => (t.noteCount ?? 0) > 0).length
  const totalNotes = tags.reduce((sum, t) => sum + (t.noteCount ?? 0), 0)

  // 使用频率高的排前面，同频次按名称排序
  const sortedTags = [...tags].sort((a, b) => {
    const diff = (b.noteCount ?? 0) - (a.noteCount ?? 0)
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-Hans-CN')
  })

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: tags.length },
    { key: 'used', label: '已使用', count: usedCount },
    { key: 'unused', label: '未使用', count: tags.length - usedCount },
  ]

  const filteredTags = sortedTags.filter((t) => {
    if (!t.name.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'used') return (t.noteCount ?? 0) > 0
    if (filter === 'unused') return (t.noteCount ?? 0) === 0
    return true
  })

  const mergeTargets = tags.filter((t) => t.id !== mergeSource?.id)

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-8 py-8">
            {/* 页头：标题 + 内联统计 */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-500/20">
                  <TagIcon size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">标签</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">按使用频率排序，点击标签查看关联笔记</p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{tags.length}</b> 个标签</span>
                <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                <span><b className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{usedCount}</b> 已使用</span>
                <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{totalNotes}</b> 篇关联</span>
              </div>
            </div>

            {/* 控制行：筛选 + 搜索 + 新建 */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                      filter === f.key
                        ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    {f.label}
                    <span className={`text-[11px] ${filter === f.key ? 'text-blue-500' : 'text-gray-400'}`}>{f.count}</span>
                  </button>
                ))}
              </div>
              <div className="relative min-w-[180px] max-w-xs flex-1">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索标签..."
                  className="w-full rounded-full border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:ring-blue-950/40"
                />
              </div>
              <button
                onClick={() => setEdit({ mode: 'create' })}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:bg-blue-600 active:scale-[0.97]"
              >
                <Plus size={16} />
                新建标签
              </button>
            </div>

            {/* 标签墙 */}
            {filteredTags.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
                  <TagIcon size={36} className="opacity-50" />
                </div>
                <p className="text-sm font-medium">
                  {search
                    ? '没有匹配的标签'
                    : filter === 'used'
                      ? '没有已使用的标签'
                      : filter === 'unused'
                        ? '没有未使用的标签'
                        : '暂无标签'}
                </p>
                <p className="mt-1 text-xs">
                  {search ? '试试其他关键词' : filter === 'unused' ? '所有标签都已关联笔记' : '点击「新建标签」开始创建'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2.5">
                  {filteredTags.map((tag) => (
                    <TagChip
                      key={tag.id}
                      tag={tag}
                      onView={() => handleViewNotes(tag)}
                      onRename={() => setEdit({ mode: 'rename', tag })}
                      onMerge={() => { setMergeSource(tag); setMergeTargetId('') }}
                      onDelete={() => handleDelete(tag)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu({ x: e.clientX, y: e.clientY, tag })
                      }}
                    />
                  ))}
                </div>
                <p className="mt-8 text-center text-xs text-gray-300 dark:text-gray-600">共 {filteredTags.length} 个标签</p>
              </>
            )}
          </div>
        </div>
      }
    >
      {/* 新建 / 重命名对话框 */}
      {edit && (
        <TagEditDialog
          key={edit.mode === 'rename' ? edit.tag.id : 'create'}
          mode={edit.mode}
          tag={edit.mode === 'rename' ? edit.tag : undefined}
          pending={createMutation.isPending || updateMutation.isPending}
          onClose={() => setEdit(null)}
          onSubmit={(name, color) => {
            if (edit.mode === 'rename') {
              updateMutation.mutate({ id: edit.tag.id, data: { name, color: color || undefined } }, { onSuccess: () => setEdit(null) })
            } else {
              createMutation.mutate({ name, color: color || undefined }, { onSuccess: () => setEdit(null) })
            }
          }}
        />
      )}

      {/* 合并对话框 */}
      {mergeSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setMergeSource(null); setMergeTargetId('') }}>
          <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
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
              <Select
                value={mergeTargetId}
                onChange={setMergeTargetId}
                options={[
                  { value: '', label: '选择目标标签', disabled: true },
                  ...mergeTargets.map((t) => ({ value: t.id, label: `#${t.name}（${t.noteCount ?? 0} 篇）` })),
                ]}
              />
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
          className="fixed min-w-[168px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
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
            <BookOpen size={14} className="text-gray-400" />
            查看笔记
          </button>
          <button
            onClick={() => { closeMenu(); setEdit({ mode: 'rename', tag: menu.tag }) }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Pencil size={14} className="text-gray-400" />
            重命名
          </button>
          <button
            onClick={() => { closeMenu(); setMergeSource(menu.tag); setMergeTargetId('') }}
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
    </AppLayout>
  )
}

/* ─── 标签胶囊 ─── */

function TagChip({
  tag,
  onView,
  onRename,
  onMerge,
  onDelete,
  onContextMenu,
}: {
  tag: ITag
  onView: () => void
  onRename: () => void
  onMerge: () => void
  onDelete: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const noteCount = tag.noteCount ?? 0
  const used = noteCount > 0
  const palette = tagPalette(tag)

  // 按使用频率分级字号，形成标签云的层次
  const size = noteCount >= 10 ? 'lg' : noteCount >= 3 ? 'md' : 'sm'
  const nameSize = size === 'lg' ? 'text-[15px]' : size === 'md' ? 'text-sm' : 'text-[13px]'
  const dotSize = size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2'
  const countSize = size === 'lg' ? 'text-xs' : 'text-[11px]'

  return (
    <div
      onContextMenu={onContextMenu}
      title={`${tag.name} · ${used ? `${noteCount} 篇笔记` : '暂无笔记'}`}
      className={`group inline-flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        used
          ? 'hover:shadow-gray-300/40 dark:hover:shadow-black/30'
          : 'border-dashed border-gray-300 bg-gray-50/80 dark:border-gray-700 dark:bg-white/[0.02]'
      }`}
      style={used ? { background: palette.soft, borderColor: `${palette.dot}33` } : undefined}
    >
      <span
        className={`shrink-0 rounded-full ${dotSize}`}
        style={{ background: used ? palette.dot : '#9ca3af' }}
      />
      <button
        onClick={onView}
        className={`font-medium ${nameSize} ${used ? '' : 'text-gray-500 dark:text-gray-400'}`}
        style={used ? { color: palette.text } : undefined}
      >
        <span className="mr-0.5 opacity-50">#</span>
        {tag.name}
      </button>
      {used && (
        <span
          className={`rounded-full bg-white/70 px-1.5 font-semibold dark:bg-black/20 ${countSize}`}
          style={{ color: palette.text }}
        >
          {noteCount}
        </span>
      )}
      <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={onRename}
          title="重命名"
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/70 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-300"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={onMerge}
          title="合并到..."
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/70 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-300"
        >
          <GitMerge size={12} />
        </button>
        <button
          onClick={onDelete}
          title="删除"
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/70 hover:text-red-600 dark:hover:bg-white/10 dark:hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  )
}

/* ─── 新建 / 重命名对话框 ─── */

function TagEditDialog({
  mode,
  tag,
  pending,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'rename'
  tag?: ITag
  pending: boolean
  onClose: () => void
  onSubmit: (name: string, color: string) => void
}) {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState(tag?.color ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="flex items-center gap-2">
            {mode === 'create' ? <Plus size={18} className="text-blue-500" /> : <Pencil size={18} className="text-blue-500" />}
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{mode === 'create' ? '新建标签' : '重命名标签'}</h3>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">名称</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), color)
                if (e.key === 'Escape') onClose()
              }}
              placeholder="输入标签名称"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-blue-950/40"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">颜色</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            onClick={() => name.trim() && onSubmit(name.trim(), color)}
            disabled={!name.trim() || pending}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '保存中...' : mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── 颜色选择器 ─── */

function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
