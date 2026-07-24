import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  Plus,
  Search,
  Trash2,
  Pin,
  Star,
  FolderPlus,
  Inbox,
} from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { notebookService } from '../services/notebookService'
import { noteService } from '../services/noteService'
import type { INote, INotebook } from '../types'

interface NotesTreeProps {
  selectedNoteId?: string
  onSelectNote: (note: INote) => void
}

interface LeafMenuState {
  x: number
  y: number
  note: INote
}

interface AddMenuState {
  x: number
  y: number
}

/** 新建菜单（笔记本 / 笔记） */
function AddMenu({ menu, onAddNotebook, onAddNote, onClose }: {
  menu: AddMenuState
  onAddNotebook: () => void
  onAddNote: () => void
  onClose: () => void
}) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        className="fixed z-[9999] min-w-[140px] overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
        style={{ left: Math.min(menu.x, window.innerWidth - 160), top: Math.min(menu.y, window.innerHeight - 120) }}
      >
        <button
          onClick={() => { onClose(); onAddNotebook() }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <FolderPlus size={13} />
          新建笔记本
        </button>
        <button
          onClick={() => { onClose(); onAddNote() }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <FileText size={13} />
          新建笔记
        </button>
      </div>
    </>,
    document.body
  )
}

/** 单个笔记本节点：展开时加载并显示其子笔记本 + 笔记 */
function NotebookNode({
  notebook,
  level,
  search,
  selectedNoteId,
  onSelectNote,
  onOpenLeafMenu,
}: {
  notebook: INotebook
  level: number
  search: string
  selectedNoteId?: string
  onSelectNote: (note: INote) => void
  onOpenLeafMenu: (e: React.MouseEvent, note: INote) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedNotebookId = useUIStore((s) => s.selectedNotebookId)
  const setSelectedNotebookId = useUIStore((s) => s.setSelectedNotebookId)
  const [expanded, setExpanded] = useState(false)
  const [isAddingChild, setIsAddingChild] = useState(false)
  const [childName, setChildName] = useState('')
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null)
  const isSelected = selectedNotebookId === notebook.id

  const { data: notesData } = useQuery({
    queryKey: ['notes-tree', notebook.id],
    queryFn: () => noteService.getList({ notebookId: notebook.id, page: 1, pageSize: 200 }),
    enabled: expanded,
  })
  const notes = (notesData?.items ?? []).filter((n) =>
    !search || (n.title || '').toLowerCase().includes(search)
  )
  const childNotebooks = notebook.children.filter((c) => !search || c.name.toLowerCase().includes(search))

  const createNote = useMutation({
    mutationFn: noteService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree', notebook.id] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  const createNotebook = useMutation({
    mutationFn: ({ parentId, name }: { parentId?: string; name: string }) =>
      notebookService.create({ parentId, name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const handleAddChildNotebook = () => {
    const trimmed = childName.trim()
    if (trimmed) {
      createNotebook.mutate({ parentId: notebook.id, name: trimmed })
    }
    setIsAddingChild(false)
    setChildName('')
    setExpanded(true)
  }

  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
          isSelected ? 'bg-blue-50/80 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
        }`}
        style={{ paddingLeft: `${8 + level * 14}px` }}
        onClick={() => setSelectedNotebookId(notebook.id)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className="shrink-0 text-gray-400"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {isSelected
          ? <FolderOpen size={15} className="shrink-0 text-blue-500" />
          : <Folder size={15} className="shrink-0 text-blue-500" />}
        <span
          className={`min-w-0 flex-1 truncate text-sm ${isSelected ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}
          onDoubleClick={() => navigate('/')}
        >
          {notebook.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setAddMenu({ x: e.clientX, y: e.clientY })
          }}
          title="新建"
          className="rounded p-0.5 text-gray-300 opacity-0 transition-all hover:bg-gray-100 hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-gray-700"
        >
          <Plus size={13} />
        </button>
      </div>

      {isAddingChild && (
        <div
          className="flex items-center gap-1.5 py-1 pr-2"
          style={{ paddingLeft: `${8 + (level + 1) * 14}px` }}
        >
          <FolderPlus size={13} className="shrink-0 text-blue-500" />
          <input
            autoFocus
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddChildNotebook()
              if (e.key === 'Escape') { setIsAddingChild(false); setChildName('') }
            }}
            onBlur={handleAddChildNotebook}
            placeholder="新子笔记本名称"
            className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[13px] outline-none dark:bg-gray-800"
          />
        </div>
      )}

      {addMenu && (
        <AddMenu
          menu={addMenu}
          onClose={() => setAddMenu(null)}
          onAddNotebook={() => { setExpanded(true); setIsAddingChild(true) }}
          onAddNote={() => { setExpanded(true); createNote.mutate({ title: '', content: '', notebookId: notebook.id }) }}
        />
      )}

      {expanded && (
        <div>
          {childNotebooks.map((child) => (
            <NotebookNode
              key={child.id}
              notebook={child}
              level={level + 1}
              search={search}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
              onOpenLeafMenu={onOpenLeafMenu}
            />
          ))}
          {notes.map((note) => {
            const active = selectedNoteId === note.id
            return (
              <div
                key={note.id}
                onClick={() => onSelectNote(note)}
                onContextMenu={(e) => { e.preventDefault(); onOpenLeafMenu(e, note) }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
                  active ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                }`}
                style={{ paddingLeft: `${8 + (level + 1) * 14 + 14}px` }}
              >
                <FileText size={13} className={`shrink-0 ${active ? 'text-blue-500' : 'text-gray-400'}`} />
                {note.isPinned && <Pin size={10} className="shrink-0 fill-blue-500 text-blue-500" />}
                {note.isFavorite && <Star size={10} className="shrink-0 fill-amber-400 text-amber-400" />}
                <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-300'}`}>
                  {note.title || '未命名笔记'}
                </span>
              </div>
            )
          })}
          {notes.length === 0 && childNotebooks.length === 0 && (
            <div
              className="py-1 text-[11px] text-gray-300 dark:text-gray-600"
              style={{ paddingLeft: `${8 + (level + 1) * 14 + 14}px` }}
            >
              空
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 折叠模式：笔记本→笔记 一棵树 */
export default function NotesTree({ selectedNoteId, onSelectNote }: NotesTreeProps) {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [leafMenu, setLeafMenu] = useState<LeafMenuState | null>(null)
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null)
  const [isAddingRoot, setIsAddingRoot] = useState(false)
  const [rootName, setRootName] = useState('')
  const [showUncategorized, setShowUncategorized] = useState(false)

  const { data: notebooks = [] } = useQuery({
    queryKey: ['notebooks'],
    queryFn: notebookService.getTree,
  })

  const { data: uncategorizedData } = useQuery({
    queryKey: ['notes-tree', 'uncategorized'],
    queryFn: () => noteService.getList({ filterNoNotebook: true, page: 1, pageSize: 200 }),
    enabled: showUncategorized,
  })
  const uncategorized = (uncategorizedData?.items ?? []).filter((n) =>
    !searchTerm || (n.title || '').toLowerCase().includes(searchTerm)
  )

  const search = searchTerm.trim().toLowerCase()
  const filteredNotebooks = notebooks.filter((n) => !search || n.name.toLowerCase().includes(search))

  const closeLeafMenu = () => setLeafMenu(null)

  const createRootNotebook = useMutation({
    mutationFn: ({ name }: { name: string }) => notebookService.create({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const createRootNote = useMutation({
    mutationFn: noteService.create,
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setShowUncategorized(true)
      onSelectNote(note)
    },
  })

  const handleCreateRootNotebook = () => {
    const trimmed = rootName.trim()
    if (trimmed) createRootNotebook.mutate({ name: trimmed })
    setIsAddingRoot(false)
    setRootName('')
  }

  const deleteNote = useMutation({
    mutationFn: noteService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      closeLeafMenu()
    },
  })

  const togglePin = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) => noteService.update(id, { isPinned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
      closeLeafMenu()
    },
  })

  const toggleFavorite = useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) => noteService.update(id, { isFavorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] })
      closeLeafMenu()
    },
  })

  const handleOpenLeafMenu = (e: React.MouseEvent, note: INote) => {
    setLeafMenu({ x: e.clientX, y: e.clientY, note })
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-gray-100 bg-white/80 dark:border-gray-800/50 dark:bg-gray-900/50">
      <div className="border-b border-gray-100 p-3 dark:border-gray-800/50">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">笔记本</h2>
          <button
            onClick={(e) => setAddMenu({ x: e.clientX, y: e.clientY })}
            title="新建"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索..."
            className="w-full rounded-lg border border-gray-200/80 bg-gray-50/80 py-1.5 pl-7 pr-2 text-[13px] outline-none transition-all placeholder:text-gray-400 focus:border-blue-300 focus:bg-white dark:border-gray-700/50 dark:bg-gray-800/50 dark:focus:border-blue-600"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isAddingRoot && (
          <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5">
            <FolderPlus size={14} className="shrink-0 text-blue-500" />
            <input
              autoFocus
              value={rootName}
              onChange={(e) => setRootName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateRootNotebook()
                if (e.key === 'Escape') { setIsAddingRoot(false); setRootName('') }
              }}
              onBlur={handleCreateRootNotebook}
              placeholder="新笔记本名称"
              className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[13px] outline-none dark:bg-gray-800"
            />
          </div>
        )}
        {filteredNotebooks.map((nb) => (
          <NotebookNode
            key={nb.id}
            notebook={nb}
            level={0}
            search={search}
            selectedNoteId={selectedNoteId}
            onSelectNote={onSelectNote}
            onOpenLeafMenu={handleOpenLeafMenu}
          />
        ))}

        {/* 未分类 */}
        <div>
          <div
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
            onClick={() => setShowUncategorized((v) => !v)}
          >
            <button className="shrink-0 text-gray-400">
              {showUncategorized ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <Inbox size={15} className="shrink-0 text-gray-400" />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-600 dark:text-gray-300">未分类</span>
          </div>
          {showUncategorized && (
            <div>
              {uncategorized.map((note) => {
                const active = selectedNoteId === note.id
                return (
                  <div
                    key={note.id}
                    onClick={() => onSelectNote(note)}
                    onContextMenu={(e) => { e.preventDefault(); handleOpenLeafMenu(e, note) }}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
                      active ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                    }`}
                    style={{ paddingLeft: '44px' }}
                  >
                    <FileText size={13} className={`shrink-0 ${active ? 'text-blue-500' : 'text-gray-400'}`} />
                    <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-300'}`}>
                      {note.title || '未命名笔记'}
                    </span>
                  </div>
                )
              })}
              {uncategorized.length === 0 && (
                <div className="py-1 text-[11px] text-gray-300 dark:text-gray-600" style={{ paddingLeft: '44px' }}>空</div>
              )}
            </div>
          )}
        </div>
      </div>

      {addMenu && (
        <AddMenu
          menu={addMenu}
          onClose={() => setAddMenu(null)}
          onAddNotebook={() => setIsAddingRoot(true)}
          onAddNote={() => createRootNote.mutate({ title: '', content: '' })}
        />
      )}

      {leafMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={closeLeafMenu} onContextMenu={(e) => { e.preventDefault(); closeLeafMenu() }} />
          <div
            className="fixed z-[9999] min-w-[150px] overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
            style={{ left: Math.min(leafMenu.x, window.innerWidth - 170), top: Math.min(leafMenu.y, window.innerHeight - 180) }}
          >
            <button
              onClick={() => { togglePin.mutate({ id: leafMenu.note.id, isPinned: !leafMenu.note.isPinned }) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Pin size={13} />
              {leafMenu.note.isPinned ? '取消置顶' : '置顶'}
            </button>
            <button
              onClick={() => { toggleFavorite.mutate({ id: leafMenu.note.id, isFavorite: !leafMenu.note.isFavorite }) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Star size={13} />
              {leafMenu.note.isFavorite ? '取消收藏' : '收藏'}
            </button>
            <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
            <button
              onClick={() => { if (confirm('确定删除这条笔记吗？')) deleteNote.mutate(leafMenu.note.id) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <Trash2 size={13} />
              删除
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
