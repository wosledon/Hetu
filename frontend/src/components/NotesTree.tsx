import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileText, Pin, Plus, Star, Trash2, CornerLeftUp } from 'lucide-react'
import { confirm } from './confirm'
import { useUIStore } from '../stores/uiStore'
import { noteService } from '../services/noteService'
import type { INote } from '../types'
import { Button, Card, ContextMenu, IconButton, SearchInput, TreeRow } from './ui'
import EmojiPicker from './EmojiPicker'

interface NotesTreeProps {
  selectedNoteId?: string
  onSelectNote: (note: INote) => void
  /** 合并到外层 Card 的样式（侧栏内嵌时去掉重复边框） */
  className?: string
}

interface LeafMenuState {
  x: number
  y: number
  note: INote
}

/** 笔记图标：emoji 或默认笔记图标，点击可更换 */
function NoteIconButton({ note, onPick }: { note: INote; onPick: (emoji: string) => void }) {
  return (
    <EmojiPicker value={note.icon} onChange={onPick}>
      {note.icon
        ? <span className="text-[13px] leading-none">{note.icon}</span>
        : <FileText size={13} className="shrink-0 text-gray-400" />}
    </EmojiPicker>
  )
}

/** 单个笔记节点：展开显示子笔记，可新建子笔记 / 重命名 / 移动 / 删除 */
function NoteNode({
  note,
  depth,
  search,
  selectedNoteId,
  onSelectNote,
  onOpenLeafMenu,
}: {
  note: INote
  depth: number
  search: string
  selectedNoteId?: string
  onSelectNote: (note: INote) => void
  onOpenLeafMenu: (e: React.MouseEvent, note: INote) => void
}) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('notes')
  const setSelectedNoteParentId = useUIStore((s) => s.setSelectedNoteParentId)
  const [expanded, setExpanded] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(note.title)
  const [isAddingChild, setIsAddingChild] = useState(false)
  const [childTitle, setChildTitle] = useState('')

  const { data: childrenData } = useQuery({
    queryKey: ['notes-tree', note.id],
    queryFn: () => noteService.getList({ parentId: note.id, page: 1, pageSize: 200 }),
    enabled: expanded,
  })
  const children = (childrenData?.items ?? []).filter((n) =>
    !search || (n.title || '').toLowerCase().includes(search)
  )

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
    queryClient.invalidateQueries({ queryKey: ['notes'] })
  }

  const createChild = useMutation({
    mutationFn: noteService.create,
    onSuccess: (created) => {
      invalidate()
      if (created) onSelectNote(created)
    },
  })

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => noteService.update(id, { title }),
    onSuccess: invalidate,
  })

  const setIcon = useMutation({
    mutationFn: ({ id, icon }: { id: string; icon: string }) => noteService.update(id, { icon }),
    onSuccess: invalidate,
  })

  const handleRename = () => {
    const trimmed = draftTitle.trim()
    if (trimmed && trimmed !== note.title) rename.mutate({ id: note.id, title: trimmed })
    setIsRenaming(false)
    setDraftTitle(note.title)
  }

  const handleAddChild = () => {
    const trimmed = childTitle.trim()
    if (trimmed) createChild.mutate({ title: trimmed, content: '', parentId: note.id })
    setIsAddingChild(false)
    setChildTitle('')
    setExpanded(true)
  }

  const active = selectedNoteId === note.id

  return (
    <div>
      <TreeRow
        depth={depth}
        expandable
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        selected={active}
        icon={
          <NoteIconButton
            note={note}
            onPick={(icon) => setIcon.mutate({ id: note.id, icon })}
          />
        }
        label={isRenaming ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') { setIsRenaming(false); setDraftTitle(note.title) }
            }}
            onBlur={handleRename}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1 py-0.5 text-[13px] outline-none dark:bg-gray-800"
          />
        ) : (
          <>
            {note.isPinned && <Pin size={10} className="mr-1 inline-block shrink-0 fill-blue-500 text-blue-500 align-[-1px]" />}
            {note.isFavorite && <Star size={10} className="mr-1 inline-block shrink-0 fill-amber-400 text-amber-400 align-[-1px]" />}
            {note.title || t('note.untitled')}
          </>
        )}
        labelClassName="text-gray-600 dark:text-gray-300"
        onClick={() => {
          onSelectNote(note)
          setSelectedNoteParentId(note.id)
        }}
        onDoubleClick={() => setIsRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenLeafMenu(e, note)
        }}
        actions={
          <IconButton variant="ghost" tone="gray" className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-600 dark:hover:bg-gray-700" label={t('tree.newChild')} onClick={(e) => {
              e.stopPropagation()
              setExpanded(true)
              setIsAddingChild(true)
            }}
            title={t('tree.newChild')}>
            <Plus size={13} />
          </IconButton>
        }
      />

      {isAddingChild && (
        <div
          className="flex items-center gap-1.5 py-1 pr-2"
          style={{ paddingLeft: `${8 + (depth + 1) * 14 + 14}px` }}
        >
          <FileText size={13} className="shrink-0 text-blue-500" />
          <input
            autoFocus
            value={childTitle}
            onChange={(e) => setChildTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddChild()
              if (e.key === 'Escape') { setIsAddingChild(false); setChildTitle('') }
            }}
            onBlur={handleAddChild}
            placeholder={t('tree.childTitlePlaceholder')}
            className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[13px] outline-none dark:bg-gray-800"
          />
        </div>
      )}

      {expanded && (
        <div>
          {/* 新建子笔记放在展开内容第一行：与子笔记同级 */}
          {!isAddingChild && (
            <TreeRow
              depth={depth + 1}
              indentExtra
              icon={<Plus size={13} className="shrink-0" />}
              label={t('tree.newChild')}
              labelClassName="text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-300"
              onClick={() => setIsAddingChild(true)}
            />
          )}
          {children.map((child) => (
            <NoteNode
              key={child.id}
              note={child}
              depth={depth + 1}
              search={search}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
              onOpenLeafMenu={onOpenLeafMenu}
            />
          ))}
          {children.length === 0 && !isAddingChild && (
            <div
              className="py-1 pr-2 text-[11px] text-gray-300 dark:text-gray-600"
              style={{ paddingLeft: `${8 + (depth + 1) * 14 + 14}px` }}
            >
              {t('tree.noChildren')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 折叠模式：嵌套笔记树（根级笔记 → 子笔记 → …） */
export default function NotesTree({ selectedNoteId, onSelectNote, className }: NotesTreeProps) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('notes')
  const [searchTerm, setSearchTerm] = useState('')
  const [leafMenu, setLeafMenu] = useState<LeafMenuState | null>(null)

  const { data: rootData } = useQuery({
    queryKey: ['notes-tree', 'root'],
    queryFn: () => noteService.getList({ filterRoot: true, page: 1, pageSize: 500 }),
  })
  const search = searchTerm.trim().toLowerCase()
  const rootNotes = (rootData?.items ?? []).filter((n) =>
    !search || (n.title || '').toLowerCase().includes(search)
  )

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
    queryClient.invalidateQueries({ queryKey: ['notes'] })
  }

  const createRootNote = useMutation({
    mutationFn: noteService.create,
    onSuccess: (created) => {
      invalidate()
      if (created) onSelectNote(created)
    },
  })

  const togglePin = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) => noteService.update(id, { isPinned }),
    onSuccess: invalidate,
  })

  const toggleFavorite = useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) => noteService.update(id, { isFavorite }),
    onSuccess: invalidate,
  })

  const moveToRoot = useMutation({
    mutationFn: (id: string) => noteService.move(id, { parentId: undefined }),
    onSuccess: invalidate,
  })

  const deleteNote = useMutation({
    mutationFn: noteService.delete,
    onSuccess: invalidate,
  })

  const closeLeafMenu = () => setLeafMenu(null)

  const handleOpenLeafMenu = (e: React.MouseEvent, note: INote) => {
    setLeafMenu({ x: e.clientX, y: e.clientY, note })
  }

  return (
    <Card padded={false} className={`flex w-64 shrink-0 flex-col border-r bg-white/80 dark:bg-gray-900/50 ${className ?? ''}`}>
      <div className="border-b border-gray-100 p-3 dark:border-gray-800/50">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('tree.label')}</h2>
        </div>
        <SearchInput tone="blue" size="sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t('tree.searchPlaceholder')}
          className="w-full"
        />
      </div>

      <div className="shrink-0 px-2 pt-2">
        <Button variant="link" tone="gray" className="mb-1 flex w-full items-center gap-1.5 rounded-xl border border-dashed border-gray-200 px-3 py-2.5 text-left text-[13px] font-medium text-gray-500 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-500/50 dark:hover:text-blue-300" onClick={() => createRootNote.mutate({ title: '', content: '' })}>
          <Plus size={14} className="shrink-0" />
          {t('tree.newNote')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {rootNotes.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] text-gray-300 dark:text-gray-600">{t('tree.empty')}</p>
        )}
        {rootNotes.map((note) => (
          <NoteNode
            key={note.id}
            note={note}
            depth={0}
            search={search}
            selectedNoteId={selectedNoteId}
            onSelectNote={onSelectNote}
            onOpenLeafMenu={handleOpenLeafMenu}
          />
        ))}
      </div>

      {leafMenu && (
        <ContextMenu
          anchor={leafMenu}
          onClose={closeLeafMenu}
          minWidth={150}
          items={[
            {
              key: 'pin',
              label: leafMenu.note.isPinned ? t('list.unpin') : t('list.pin'),
              icon: <Pin size={13} />,
              onSelect: () => togglePin.mutate({ id: leafMenu.note.id, isPinned: !leafMenu.note.isPinned }),
            },
            {
              key: 'favorite',
              label: leafMenu.note.isFavorite ? t('list.unfavorite') : t('list.favorite'),
              icon: <Star size={13} />,
              onSelect: () => toggleFavorite.mutate({ id: leafMenu.note.id, isFavorite: !leafMenu.note.isFavorite }),
            },
            {
              key: 'move-root',
              label: t('tree.moveToRoot'),
              icon: <CornerLeftUp size={13} />,
              onSelect: () => moveToRoot.mutate(leafMenu.note.id),
            },
            { kind: 'separator' },
            {
              key: 'delete',
              label: t('common:delete'),
              icon: <Trash2 size={13} />,
              danger: true,
              onSelect: () => confirm({
                message: t('tree.deleteConfirm'),
                onConfirm: () => deleteNote.mutate(leafMenu.note.id),
              }),
            },
          ]}
        />
      )}
    </Card>
  )
}
