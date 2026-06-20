import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderInput, Pin, Plus, Search, Star, Trash2, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useUIStore } from '../stores/uiStore'
import { noteService } from '../services/noteService'
import { notebookService } from '../services/notebookService'
import { tagPalette } from '../utils/tagColor'
import type { INote, INotebook } from '../types'

interface NoteListProps {
  onSelectNote: (note: INote) => void
  selectedNoteId?: string
  includeDeleted?: boolean
}

const ITEM_HEIGHT = 116
const OVERSCAN = 5

interface ContextMenuState {
  x: number
  y: number
  note: INote
}

export default function NoteList({
  onSelectNote,
  selectedNoteId,
  includeDeleted = false,
}: NoteListProps) {
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const hasValidHeight = useRef(false)
  const DEFAULT_NOTEBOOK_ID = 'default'
  const selectedNotebookId = useUIStore((state) => state.selectedNotebookId)
  const selectedTagId = useUIStore((state) => state.selectedTagId)
  const { data, isLoading } = useQuery({
    queryKey: ['notes', { selectedNotebookId, selectedTagId, includeDeleted }],
    queryFn: () =>
      noteService.getList({
        notebookId: selectedNotebookId === DEFAULT_NOTEBOOK_ID ? undefined : selectedNotebookId,
        filterNoNotebook: selectedNotebookId === DEFAULT_NOTEBOOK_ID,
        tagId: selectedTagId,
        includeDeleted,
        page: 1,
        pageSize: 100,
      }),
  })

  const { data: notebooks = [] } = useQuery({
    queryKey: ['notebooks'],
    queryFn: () => notebookService.getTree(),
    enabled: !includeDeleted,
  })

  const createNote = useMutation({
    mutationFn: noteService.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
  })

  const deleteNote = useMutation({
    mutationFn: noteService.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
  })

  const restoreNote = useMutation({
    mutationFn: noteService.restore,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
  })

  const hardDeleteNote = useMutation({
    mutationFn: noteService.hardDelete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
  })

  const toggleFavorite = useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      noteService.update(id, { isFavorite }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
  })

  const togglePin = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) =>
      noteService.update(id, { isPinned }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
  })

  const moveNote = useMutation({
    mutationFn: ({ id, notebookId }: { id: string; notebookId?: string }) =>
      noteService.move(id, { notebookId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
  })

  const notes = useMemo(() => {
    const allNotes = data?.items ?? []
    const keyword = searchTerm.trim().toLowerCase()
    if (!keyword) return allNotes
    return allNotes.filter((note) =>
      `${note.title} ${note.content}`.toLowerCase().includes(keyword)
    )
  }, [data?.items, searchTerm])
  const notebookOptions = useMemo(() => {
    const flatten = (items: INotebook[], depth = 0): { id: string; name: string }[] =>
      items.flatMap((notebook) => [
        { id: notebook.id, name: `${'　'.repeat(depth)}${notebook.name}` },
        ...flatten(notebook.children ?? [], depth + 1),
      ])
    return flatten(notebooks)
  }, [notebooks])

  const handleCreate = () => {
    createNote.mutate({ title: '', content: '', notebookId: selectedNotebookId })
  }

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

  const handleScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const updateHeight = (height: number) => {
      if (height > 0) {
        hasValidHeight.current = true
        setContainerHeight(height)
      } else if (!hasValidHeight.current) {
        setContainerHeight(400)
      }
    }

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        updateHeight(entry.contentRect.height)
      }
    })

    observer.observe(el)

    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      updateHeight(rect.height)
    })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (scrollRef.current && selectedNoteId && containerHeight > 0) {
      const idx = notes.findIndex(n => n.id === selectedNoteId)
      if (idx >= 0) {
        const itemTop = idx * ITEM_HEIGHT
        const itemBottom = itemTop + ITEM_HEIGHT
        const viewTop = scrollRef.current.scrollTop
        const viewBottom = viewTop + containerHeight
        if (itemTop < viewTop || itemBottom > viewBottom) {
          scrollRef.current.scrollTo({ top: Math.max(0, itemTop - containerHeight / 2), behavior: 'smooth' })
        }
      }
    }
  }, [selectedNoteId, notes, containerHeight])

  const totalHeight = notes.length * ITEM_HEIGHT
  const safeHeight = containerHeight || 400
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(
    notes.length,
    Math.ceil((scrollTop + safeHeight) / ITEM_HEIGHT) + OVERSCAN
  )
  const visibleNotes = notes.slice(startIndex, endIndex)
  const offsetY = startIndex * ITEM_HEIGHT

  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-gray-100 bg-white/60 dark:border-gray-800/50 dark:bg-gray-900/40">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800/50">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {selectedNotebookId ? '笔记本笔记' : selectedTagId ? '标签笔记' : includeDeleted ? '回收站' : '全部笔记'}
          </h2>
          {!includeDeleted && (
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md hover:shadow-blue-500/25 hover:brightness-110 active:scale-[0.97]"
              title="新建笔记"
            >
              <Plus size={13} />
              新建
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索笔记..."
            className="w-full rounded-lg border border-gray-200/80 bg-gray-50/80 py-2 pl-8 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:shadow-sm focus:shadow-blue-500/5 focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700/50 dark:bg-gray-800/50 dark:placeholder:text-gray-500 dark:focus:border-blue-600 dark:focus:bg-gray-800"
          />
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2" onScroll={handleScroll}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
            <div className="relative mb-3">
              <div className="h-10 w-10 rounded-full border-2 border-gray-200 dark:border-gray-700" />
              <div className="absolute inset-0 h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-blue-500" />
            </div>
            <p className="text-xs text-gray-400">加载中...</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 shadow-inner dark:from-blue-900/20 dark:to-indigo-900/20">
              <Search size={22} className="text-blue-400/70" />
            </div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">暂无笔记</p>
            {!includeDeleted && <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">点击上方「新建」创建第一条笔记</p>}
          </div>
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleNotes.map((note) => {
                const isSelected = selectedNoteId === note.id
                return (
                  <div
                    key={note.id}
                    onClick={() => onSelectNote(note)}
                    onContextMenu={(e) => {
                      if (includeDeleted) return
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, note })
                    }}
                    style={{ height: ITEM_HEIGHT }}
                    className={`note-card group mb-1 cursor-pointer rounded-xl border px-4 py-3 ${
                      isSelected
                        ? 'border-blue-200/60 bg-gradient-to-br from-blue-50/80 to-indigo-50/40 shadow-sm shadow-blue-500/5 dark:border-blue-800/40 dark:from-blue-950/40 dark:to-indigo-950/20'
                        : 'border-transparent bg-white/70 hover:border-gray-100 hover:bg-white hover:shadow-sm dark:bg-gray-900/50 dark:hover:border-gray-800 dark:hover:bg-gray-900/80 dark:hover:shadow-black/10'
                    }`}
                  >
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <h3 className={`line-clamp-1 flex-1 text-[13px] leading-snug ${isSelected ? 'font-semibold text-blue-700 dark:text-blue-200' : 'font-medium text-gray-700 dark:text-gray-200'}`}>{note.title || '未命名笔记'}</h3>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {includeDeleted ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); restoreNote.mutate(note.id) }}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20"
                              title="恢复"
                            >
                              <RotateCcw size={13} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); hardDeleteNote.mutate(note.id) }}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                              title="彻底删除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); togglePin.mutate({ id: note.id, isPinned: !note.isPinned }) }}
                              className={`rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${note.isPinned ? 'text-blue-500' : 'text-gray-300 opacity-0 group-hover:opacity-100 dark:text-gray-600'}`}
                              title={note.isPinned ? '取消置顶' : '置顶'}
                            >
                              <Pin size={13} className={note.isPinned ? 'fill-blue-500' : ''} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleFavorite.mutate({ id: note.id, isFavorite: !note.isFavorite }) }}
                              className={`rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${note.isFavorite ? 'text-amber-400' : 'text-gray-300 opacity-0 group-hover:opacity-100 dark:text-gray-600'}`}
                              title={note.isFavorite ? '取消收藏' : '收藏'}
                            >
                              <Star size={13} className={note.isFavorite ? 'fill-amber-400' : ''} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteNote.mutate(note.id) }}
                              className="rounded-lg p-1.5 text-gray-300 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-red-900/20"
                              title="删除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{note.content || '无内容'}</p>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {note.tags.map((tag) => {
                          const palette = tagPalette(tag)
                          return (
                            <span
                              key={tag.id}
                              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: palette.soft, color: palette.text }}
                            >
                              {tag.name}
                            </span>
                          )
                        })}
                      </div>
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: zhCN })}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 右键操作菜单 */}
      {menu && createPortal(
        <div
          ref={menuRef}
          className="fixed min-w-[168px] overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
          style={{
            left: Math.min(menu.x, window.innerWidth - 188),
            top: Math.min(menu.y, window.innerHeight - 260),
            zIndex: 50,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { closeMenu(); togglePin.mutate({ id: menu.note.id, isPinned: !menu.note.isPinned }) }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Pin size={14} className={menu.note.isPinned ? 'text-blue-500' : 'text-gray-400'} />
            {menu.note.isPinned ? '取消置顶' : '置顶'}
          </button>
          <button
            onClick={() => { closeMenu(); toggleFavorite.mutate({ id: menu.note.id, isFavorite: !menu.note.isFavorite }) }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Star size={14} className={menu.note.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-gray-400'} />
            {menu.note.isFavorite ? '取消收藏' : '收藏'}
          </button>
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400">移动到笔记本</div>
          <div className="max-h-44 overflow-y-auto">
            <button
              onClick={() => { closeMenu(); moveNote.mutate({ id: menu.note.id, notebookId: undefined }) }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${!menu.note.notebookId ? 'text-blue-600 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}
            >
              <FolderInput size={14} className="text-gray-400" />
              无笔记本
            </button>
            {notebookOptions.map((nb) => (
              <button
                key={nb.id}
                onClick={() => { closeMenu(); moveNote.mutate({ id: menu.note.id, notebookId: nb.id }) }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${menu.note.notebookId === nb.id ? 'text-blue-600 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}
              >
                <FolderInput size={14} className="text-gray-400" />
                <span className="truncate">{nb.name}</span>
              </button>
            ))}
          </div>
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            onClick={() => { closeMenu(); deleteNote.mutate(menu.note.id) }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
