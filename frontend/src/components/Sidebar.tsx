import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Pencil,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { notebookService } from '../services/notebookService'
import type { INotebook } from '../types'

function NotebookTreeItem({
  notebook,
  level,
}: {
  notebook: INotebook
  level: number
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedNotebookId = useUIStore((state) => state.selectedNotebookId)
  const setSelectedNotebookId = useUIStore((state) => state.setSelectedNotebookId)
  const isSelected = selectedNotebookId === notebook.id
  const [isExpanded, setIsExpanded] = useState(true)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftName, setDraftName] = useState(notebook.name)
  const [isAddingChild, setIsAddingChild] = useState(false)
  const [childName, setChildName] = useState('')
  const [, setIsHovered] = useState(false)

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      notebookService.update(id, { name, parentId: notebook.parentId, sortOrder: notebook.sortOrder }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const createMutation = useMutation({
    mutationFn: ({ parentId, name }: { parentId?: string; name: string }) =>
      notebookService.create({ parentId, name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notebookService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
    onError: (err: Error) => alert(err.message || '删除笔记本失败'),
  })

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (!menu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu()
      }
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

  const handleRename = () => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== notebook.name) {
      updateMutation.mutate({ id: notebook.id, name: trimmed })
    }
    setIsRenaming(false)
    setDraftName(notebook.name)
  }

  const handleCreateChild = () => {
    const trimmed = childName.trim()
    if (trimmed) {
      createMutation.mutate({ parentId: notebook.id, name: trimmed })
    }
    setIsAddingChild(false)
    setChildName('')
    setIsExpanded(true)
  }

  const handleDelete = () => {
    if (confirm(`确定删除笔记本「${notebook.name}」吗？其中的笔记将变为未分类。`)) {
      deleteMutation.mutate(notebook.id)
    }
  }

  return (
    <div className="group">
      <div
        className={`group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 transition-all ${
          isSelected
            ? 'bg-blue-50/80 shadow-sm shadow-blue-500/5 dark:bg-blue-950/40'
            : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
        }`}
        style={{ marginLeft: `${level * 12}px` }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => {
          setSelectedNotebookId(notebook.id)
          navigate('/')
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {isRenaming ? (
          <div className="flex min-w-0 flex-1 items-center space-x-2">
            <Folder size={16} className="shrink-0 text-blue-500" />
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') {
                  setIsRenaming(false)
                  setDraftName(notebook.name)
                }
              }}
              onBlur={handleRename}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1 py-0.5 text-sm outline-none dark:bg-gray-800"
            />
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center space-x-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsExpanded((v) => !v)
                }}
                className={`shrink-0 text-gray-400 ${notebook.children.length === 0 ? 'invisible' : ''}`}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {isSelected ? <FolderOpen size={16} className="shrink-0 text-blue-500" /> : <Folder size={16} className="shrink-0 text-blue-500" />}
              <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>{notebook.name}</span>
            </div>
          </>
        )}
      </div>

      {isAddingChild && (
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
        >
          <Folder size={14} className="text-gray-500" />
          <input
            autoFocus
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateChild()
              if (e.key === 'Escape') {
                setIsAddingChild(false)
                setChildName('')
              }
            }}
            onBlur={handleCreateChild}
            placeholder="新笔记本名称"
            className="flex-1 min-w-0 text-sm px-1 py-0.5 bg-white dark:bg-gray-800 border border-indigo-300 rounded outline-none"
          />
        </div>
      )}

      {isExpanded &&
        notebook.children.map((child) => (
          <NotebookTreeItem key={child.id} notebook={child} level={level + 1} />
        ))}

      {menu && createPortal(
        <div
          ref={menuRef}
          className="fixed min-w-[160px] overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(menu.y, window.innerHeight - 160),
            zIndex: 50,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { closeMenu(); setIsExpanded(true); setIsAddingChild(true) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Plus size={14} />
            新建子笔记本
          </button>
          <button
            onClick={() => { closeMenu(); setDraftName(notebook.name); setIsRenaming(true) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Pencil size={14} />
            重命名
          </button>
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
          <button
            onClick={() => { closeMenu(); handleDelete() }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
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

export default function Sidebar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedNotebookId = useUIStore((state) => state.selectedNotebookId)
  const setSelectedNotebookId = useUIStore((state) => state.setSelectedNotebookId)
  const setSelectedTagId = useUIStore((state) => state.setSelectedTagId)
  const [isAddingRoot, setIsAddingRoot] = useState(false)
  const [rootName, setRootName] = useState('')

  const DEFAULT_NOTEBOOK_ID = 'default'
  const isDefaultSelected = selectedNotebookId === DEFAULT_NOTEBOOK_ID

  const { data: notebooks = [] } = useQuery({
    queryKey: ['notebooks'],
    queryFn: notebookService.getTree,
  })

  const createNotebookMutation = useMutation({
    mutationFn: (name: string) => notebookService.create({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const handleCreateRoot = () => {
    const trimmed = rootName.trim()
    if (trimmed) {
      createNotebookMutation.mutate(trimmed)
    }
    setIsAddingRoot(false)
    setRootName('')
  }


  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-gray-100 bg-white/80 dark:border-gray-800/50 dark:bg-gray-900/50">
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">笔记本</h2>
          <button
            onClick={() => setIsAddingRoot(true)}
            title="新建笔记本"
            className="rounded-lg p-1.5 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="notebook-tree flex-1 space-y-0.5 overflow-y-auto">
          {isAddingRoot && (
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
              <Folder size={14} className="text-blue-500" />
              <input
                autoFocus
                value={rootName}
                onChange={(e) => setRootName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateRoot()
                  if (e.key === 'Escape') {
                    setIsAddingRoot(false)
                    setRootName('')
                  }
                }}
                onBlur={handleCreateRoot}
                placeholder="新笔记本名称"
                className="min-w-0 flex-1 rounded-md border border-blue-300 bg-white px-2 py-0.5 text-sm outline-none dark:bg-gray-800"
              />
            </div>
          )}
          {/* 默认笔记本 - 未分类笔记 */}
          <div
            onClick={() => {
              setSelectedNotebookId(DEFAULT_NOTEBOOK_ID)
              navigate('/')
            }}
            className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-all ${
              isDefaultSelected
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]'
            }`}
          >
            <Folder size={14} className={isDefaultSelected ? 'text-blue-500' : 'text-gray-400'} />
            <span className="flex-1 truncate text-sm">默认笔记本</span>
          </div>
          {/* 分隔线 */}
          {notebooks.length > 0 && (
            <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
          )}
          {/* 其他笔记本 */}
          {notebooks.map((notebook) => (
            <NotebookTreeItem key={notebook.id} notebook={notebook} level={0} />
          ))}
        </div>
      </div>
    </aside>
  )
}
