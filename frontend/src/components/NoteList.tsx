import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CornerLeftUp, FileText, Pin, Plus, Search, Star, Trash2, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { useUIStore } from '../stores/uiStore'
import { noteService } from '../services/noteService'
import { tagPalette } from '../utils/tagColor'
import { uiLocale } from '../utils/locale'
import type { INote } from '../types'
import { Card, ContextMenu, IconButton, SearchInput } from './ui'
import EmojiPicker from './EmojiPicker'

interface NoteListProps {
  onSelectNote: (note: INote) => void
  onDeleteNote?: (id: string) => void
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
  onDeleteNote,
  selectedNoteId,
  includeDeleted = false,
}: NoteListProps) {
  const { t } = useTranslation('notes')
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const hasValidHeight = useRef(false)
  const selectedNoteParentId = useUIStore((state) => state.selectedNoteParentId)
  const selectedTagId = useUIStore((state) => state.selectedTagId)
  const { data, isLoading } = useQuery({
    queryKey: ['notes', { selectedNoteParentId, selectedTagId, includeDeleted }],
    queryFn: () =>
      noteService.getList({
        parentId: selectedNoteParentId,
        tagId: selectedTagId,
        includeDeleted,
        page: 1,
        pageSize: 100,
      }),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notes'] })
    queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
  }

  const createNote = useMutation({
    mutationFn: noteService.create,
    onSuccess: (created) => {
      invalidate()
      // 新建后直接打开编辑器，给用户即时反馈
      if (created) onSelectNote?.(created)
    },
  })

  const deleteNote = useMutation({
    mutationFn: noteService.delete,
    onSuccess: (_data, id) => {
      invalidate()
      onDeleteNote?.(id)
    },
  })

  const restoreNote = useMutation({
    mutationFn: noteService.restore,
    onSuccess: invalidate,
  })

  const hardDeleteNote = useMutation({
    mutationFn: noteService.hardDelete,
    onSuccess: (_data, id) => {
      invalidate()
      onDeleteNote?.(id)
    },
  })

  const toggleFavorite = useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      noteService.update(id, { isFavorite }),
    onSuccess: invalidate,
  })

  const togglePin = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) =>
      noteService.update(id, { isPinned }),
    onSuccess: invalidate,
  })

  const setIcon = useMutation({
    mutationFn: ({ id, icon }: { id: string; icon: string }) =>
      noteService.update(id, { icon }),
    onSuccess: invalidate,
  })

  const moveToRoot = useMutation({
    mutationFn: (id: string) => noteService.move(id, { parentId: undefined }),
    onSuccess: invalidate,
  })

  const notes = useMemo(() => {
    const allNotes = data?.items ?? []
    const keyword = searchTerm.trim().toLowerCase()
    if (!keyword) return allNotes
    return allNotes.filter((note) =>
      `${note.title} ${note.content}`.toLowerCase().includes(keyword)
    )
  }, [data?.items, searchTerm])

  const handleCreate = () => {
    createNote.mutate({
      title: '',
      content: '',
      parentId: selectedNoteParentId,
    })
  }

  const closeMenu = useCallback(() => setMenu(null), [])

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
    <Card padded={false} className="flex w-80 shrink-0 flex-col border-r bg-white/60 dark:bg-gray-900/40">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800/50">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {selectedNoteParentId
              ? t('list.titleChildren')
              : selectedTagId
                ? t('list.titleTag')
                : includeDeleted
                  ? t('list.titleTrash')
                  : t('list.titleAll')}
          </h2>
          {!includeDeleted && (
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md hover:shadow-blue-500/25 hover:brightness-110 active:scale-[0.97]"
              title={t('note.newNote')}
            >
              <Plus size={13} />
              {t('common:create')}
            </button>
          )}
        </div>
        <SearchInput tone="blue"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t('list.searchPlaceholder')}
          className="w-full"
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2" onScroll={handleScroll}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
            <div className="relative mb-3">
              <div className="h-10 w-10 rounded-full border-2 border-gray-200 dark:border-gray-700" />
              <div className="absolute inset-0 h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-blue-500" />
            </div>
            <p className="text-xs text-gray-400">{t('common:loading')}</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 shadow-inner dark:from-blue-900/20 dark:to-indigo-900/20">
              <Search size={22} className="text-blue-400/70" />
            </div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('list.empty')}</p>
            {!includeDeleted && <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{t('list.emptyHint')}</p>}
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
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        {/* 笔记图标：emoji 或默认笔记图标，点击更换 */}
                        <EmojiPicker
                          value={note.icon}
                          onChange={(icon) => setIcon.mutate({ id: note.id, icon })}
                        >
                          {note.icon
                            ? <span className="text-[15px] leading-none">{note.icon}</span>
                            : <FileText size={14} className="shrink-0 text-gray-400" />}
                        </EmojiPicker>
                        <h3 className={`line-clamp-1 flex-1 text-[13px] leading-snug ${isSelected ? 'font-semibold text-blue-700 dark:text-blue-200' : 'font-medium text-gray-700 dark:text-gray-200'}`}>{note.title || t('note.untitled')}</h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {includeDeleted ? (
                          <>
                            <IconButton variant="ghost" tone="gray" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20" label={t('list.restore')} onClick={(e) => { e.stopPropagation(); restoreNote.mutate(note.id) }}
                              
                              title={t('list.restore')}>
                              <RotateCcw size={13} />
                            </IconButton>
                            <IconButton variant="ghost" tone="gray" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20" label={t('list.hardDelete')} onClick={(e) => { e.stopPropagation(); hardDeleteNote.mutate(note.id) }}
                              
                              title={t('list.hardDelete')}>
                              <Trash2 size={13} />
                            </IconButton>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); togglePin.mutate({ id: note.id, isPinned: !note.isPinned }) }}
                              className={`rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${note.isPinned ? 'text-blue-500' : 'text-gray-300 opacity-0 group-hover:opacity-100 dark:text-gray-600'}`}
                              title={note.isPinned ? t('list.unpin') : t('list.pin')}
                            >
                              <Pin size={13} className={note.isPinned ? 'fill-blue-500' : ''} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleFavorite.mutate({ id: note.id, isFavorite: !note.isFavorite }) }}
                              className={`rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${note.isFavorite ? 'text-amber-400' : 'text-gray-300 opacity-0 group-hover:opacity-100 dark:text-gray-600'}`}
                              title={note.isFavorite ? t('list.unfavorite') : t('list.favorite')}
                            >
                              <Star size={13} className={note.isFavorite ? 'fill-amber-400' : ''} />
                            </button>
                            <IconButton variant="ghost" tone="gray" className="rounded-lg p-1.5 text-gray-300 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-red-900/20" label={t('common:delete')} onClick={(e) => { e.stopPropagation(); deleteNote.mutate(note.id) }}
                              
                              title={t('common:delete')}>
                              <Trash2 size={13} />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{note.content || t('note.noContent')}</p>
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
                        {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: uiLocale() === 'en' ? enUS : zhCN })}
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
      {menu && (
        <ContextMenu
          anchor={menu}
          onClose={closeMenu}
          minWidth={180}
          items={[
            {
              key: 'pin',
              label: menu.note.isPinned ? t('list.unpin') : t('list.pin'),
              icon: <Pin size={14} className={menu.note.isPinned ? 'text-blue-500' : 'text-gray-400'} />,
              onSelect: () => togglePin.mutate({ id: menu.note.id, isPinned: !menu.note.isPinned }),
            },
            {
              key: 'favorite',
              label: menu.note.isFavorite ? t('list.unfavorite') : t('list.favorite'),
              icon: <Star size={14} className={menu.note.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-gray-400'} />,
              onSelect: () => toggleFavorite.mutate({ id: menu.note.id, isFavorite: !menu.note.isFavorite }),
            },
            {
              key: 'move-root',
              label: t('list.moveToRoot'),
              icon: <CornerLeftUp size={14} className="text-gray-400" />,
              onSelect: () => moveToRoot.mutate(menu.note.id),
            },
            { kind: 'separator' },
            {
              key: 'delete',
              label: t('common:delete'),
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => deleteNote.mutate(menu.note.id),
            },
          ]}
        />
      )}
    </Card>
  )
}
