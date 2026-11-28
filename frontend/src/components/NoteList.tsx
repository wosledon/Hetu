import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CornerLeftUp, FileText, Pin, Plus, Search, Star, Trash2, RotateCcw, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { useUIStore } from '../stores/uiStore'
import { useNoteSearch } from '../hooks/useNoteSearch'
import { noteService } from '../services/noteService'
import { tagPalette } from '../utils/tagColor'
import { uiLocale } from '../utils/locale'
import type { INote } from '../types'
import { ContextMenu, IconButton, SearchInput, Spinner, SurfaceButton, WorkbenchColumn } from './ui'
import EmojiPicker from './EmojiPicker'
import NoteSearchResults from './NoteSearchResults'

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
  const [searchActiveIndex, setSearchActiveIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
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

  const notes = useMemo(() => data?.items ?? [], [data])

  // ---- 搜索：标题 + 正文服务端检索（标签范围内），命中时结果替换当前列表 ----
  const searchKeyword = searchTerm.trim()
  const searchActive = searchKeyword.length > 0
  const { results: searchResults, total: searchTotal, ready: searchReady, inFlight: searchInFlight } = useNoteSearch(searchTerm, { tagId: selectedTagId, includeDeleted })
  const activeSearchIndex = searchResults.length > 0 ? Math.min(searchActiveIndex, searchResults.length - 1) : -1

  const openSearchResult = async (id: string) => {
    try {
      onSelectNote(await noteService.getById(id))
    } catch {
      // 结果已失效（被删除或移动）时忽略，下一次输入会重新检索
    }
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setSearchTerm('')
      return
    }
    if (searchResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSearchActiveIndex(Math.min(activeSearchIndex + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSearchActiveIndex(Math.max(activeSearchIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = searchResults[Math.max(0, activeSearchIndex)]
      if (target) void openSearchResult(target.id)
    }
  }

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
    <WorkbenchColumn
      role="list"
      title={selectedNoteParentId
        ? t('list.titleChildren')
        : selectedTagId
          ? t('list.titleTag')
          : includeDeleted
            ? t('list.titleTrash')
            : t('list.titleAll')}
      count={searchActive ? undefined : notes.length}
      actions={!includeDeleted ? (
        <SurfaceButton
          onClick={handleCreate}
          className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md hover:shadow-blue-500/25 hover:brightness-110 active:scale-[0.97]"
          title={t('note.newNote')}
        >
          <Plus size={12} />
          {t('common:create')}
        </SurfaceButton>
      ) : undefined}
      toolbar={
        <SearchInput tone="blue" ref={searchInputRef}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('list.searchPlaceholder')}
          className="w-full"
          iconRight={searchInFlight
            ? <Spinner size={13} />
            : searchActive
              ? <IconButton
                  size="xs"
                  variant="bare"
                  label={t('search.clear')}
                  onClick={() => { setSearchTerm(''); searchInputRef.current?.focus() }}
                >
                  <X size={12} />
                </IconButton>
              : undefined}
        />
      }
      bodyRef={scrollRef}
      onBodyScroll={handleScroll}
    >
        {searchActive ? (
          <NoteSearchResults
            keyword={searchKeyword}
            results={searchResults}
            total={searchTotal}
            ready={searchReady}
            inFlight={searchInFlight}
            activeIndex={activeSearchIndex}
            selectedNoteId={selectedNoteId}
            onHover={setSearchActiveIndex}
            onOpen={(id) => void openSearchResult(id)}
          />
        ) : isLoading ? (
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
                        ? 'border-blue-300/70 bg-blue-50/60 dark:border-blue-400/30 dark:bg-blue-500/[0.08]'
                        : 'border-gray-200/70 bg-white/60 hover:border-gray-300 hover:shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-white/[0.15]'
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
                            <IconButton variant="success" size="tiny" label={t('list.restore')} onClick={(e) => { e.stopPropagation(); restoreNote.mutate(note.id) }}>
                              <RotateCcw size={13} />
                            </IconButton>
                            <IconButton variant="danger" size="tiny" label={t('list.hardDelete')} onClick={(e) => { e.stopPropagation(); hardDeleteNote.mutate(note.id) }}>
                              <Trash2 size={13} />
                            </IconButton>
                          </>
                        ) : (
                          <>
                            <IconButton
                              variant="ghost"
                              tone="blue"
                              size="tiny"
                              active={note.isPinned}
                              label={note.isPinned ? t('list.unpin') : t('list.pin')}
                              className={note.isPinned ? '' : 'opacity-0 group-hover:opacity-100'}
                              onClick={(e) => { e.stopPropagation(); togglePin.mutate({ id: note.id, isPinned: !note.isPinned }) }}
                            >
                              <Pin size={13} className={note.isPinned ? 'fill-blue-500' : ''} />
                            </IconButton>
                            <IconButton
                              variant="ghost"
                              tone="amber"
                              size="tiny"
                              active={note.isFavorite}
                              label={note.isFavorite ? t('list.unfavorite') : t('list.favorite')}
                              className={note.isFavorite ? '' : 'opacity-0 group-hover:opacity-100'}
                              onClick={(e) => { e.stopPropagation(); toggleFavorite.mutate({ id: note.id, isFavorite: !note.isFavorite }) }}
                            >
                              <Star size={13} className={note.isFavorite ? 'fill-amber-400' : ''} />
                            </IconButton>
                            <IconButton variant="danger" size="tiny" label={t('common:delete')} className="opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); deleteNote.mutate(note.id) }}>
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
    </WorkbenchColumn>
  )
}
