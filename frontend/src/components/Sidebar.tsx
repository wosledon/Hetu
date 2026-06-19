import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Tag,
  Pencil,
  Folder,
  FolderOpen,
  GitMerge,
} from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { notebookService } from '../services/notebookService'
import { tagService } from '../services/tagService'
import { getTagColorClasses } from '../utils/tagColor'
import type { INotebook, ITag } from '../types'

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
  const [isHovered, setIsHovered] = useState(false)

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
  })

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
        className={`group flex cursor-pointer items-center justify-between rounded px-2 py-1.5 transition-colors ${
          isSelected
            ? 'bg-blue-50 dark:bg-blue-950/40'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        style={{ marginLeft: `${level * 16}px` }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => {
          setSelectedNotebookId(notebook.id)
          navigate('/')
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
              <span className={`truncate text-sm ${isSelected ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>{notebook.name}</span>
            </div>
            <div className="relative ml-2 flex h-5 w-16 shrink-0 items-center justify-end">
              <span className={`absolute right-0 text-xs transition-opacity ${isHovered || isAddingChild ? 'opacity-0' : 'opacity-100'} ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>{notebook.children.length}</span>
              <div className={`absolute right-0 flex items-center gap-0.5 transition-opacity ${isHovered || isAddingChild ? 'opacity-100' : 'opacity-0'} ${isHovered || isAddingChild ? '' : 'pointer-events-none'}`}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsAddingChild(true)
                  }}
                  title="新建子笔记本"
                  className="rounded p-0.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <Plus size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDraftName(notebook.name)
                    setIsRenaming(true)
                  }}
                  title="重命名"
                  className="rounded p-0.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete()
                  }}
                  title="删除"
                  className="rounded p-0.5 text-gray-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                >
                  <Trash2 size={12} />
                </button>
              </div>
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
    </div>
  )
}

function TagItem({
  tag,
  allTags,
}: {
  tag: ITag
  allTags: ITag[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedTagId = useUIStore((state) => state.selectedTagId)
  const setSelectedTagId = useUIStore((state) => state.setSelectedTagId)
  const isSelected = selectedTagId === tag.id
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftName, setDraftName] = useState(tag.name)
  const [isMerging, setIsMerging] = useState(false)
  const [targetTagId, setTargetTagId] = useState('')
  const [isHovered, setIsHovered] = useState(false)

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      tagService.update(id, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tagService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      if (isSelected) setSelectedTagId(undefined)
    },
  })

  const mergeMutation = useMutation({
    mutationFn: ({ sourceTagIds, targetTagId }: { sourceTagIds: string[]; targetTagId: string }) =>
      tagService.merge({ sourceTagIds, targetTagId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setIsMerging(false)
      setTargetTagId('')
      if (isSelected) setSelectedTagId(undefined)
    },
  })

  const handleRename = () => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== tag.name) {
      updateMutation.mutate({ id: tag.id, name: trimmed })
    }
    setIsRenaming(false)
    setDraftName(tag.name)
  }

  const handleDelete = () => {
    if (confirm(`确定删除标签「${tag.name}」吗？相关笔记将不再关联此标签。`)) {
      deleteMutation.mutate(tag.id)
    }
  }

  const handleMerge = () => {
    if (!targetTagId) return
    if (targetTagId === tag.id) {
      alert('不能合并到自身')
      return
    }
    mergeMutation.mutate({ sourceTagIds: [tag.id], targetTagId })
  }

  const mergeTargets = allTags.filter((t) => t.id !== tag.id)

  return (
    <div
      className="group relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-1">
        {isRenaming ? (
          <>
            <Tag size={14} style={{ color: tag.color || '#6b7280' }} />
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') {
                  setIsRenaming(false)
                  setDraftName(tag.name)
                }
              }}
              onBlur={handleRename}
              className="flex-1 min-w-0 text-sm px-1 py-0.5 bg-white dark:bg-gray-800 border border-indigo-300 rounded outline-none"
            />
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setSelectedTagId(tag.id)
                navigate('/')
              }}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ${
                isSelected
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                  : getTagColorClasses(tag.name, tag.color)
              }`}
            >
              <span># {tag.name}</span>
            </button>
            {(isHovered || isMerging) && (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setIsMerging(true)}
                  title="合并"
                  className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
                >
                  <GitMerge size={12} />
                </button>
                <button
                  onClick={() => {
                    setDraftName(tag.name)
                    setIsRenaming(true)
                  }}
                  title="重命名"
                  className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={handleDelete}
                  title="删除"
                  className="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-600"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {isMerging && (
        <div className="flex items-center gap-1 px-2 py-1 pl-8">
          <select
            value={targetTagId}
            onChange={(e) => setTargetTagId(e.target.value)}
            className="flex-1 min-w-0 text-sm px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded outline-none"
          >
            <option value="">选择目标标签</option>
            {mergeTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleMerge}
            className="px-2 py-0.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            合并
          </button>
          <button
            onClick={() => {
              setIsMerging(false)
              setTargetTagId('')
            }}
            className="px-2 py-0.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            取消
          </button>
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSelectedTagId = useUIStore((state) => state.setSelectedTagId)
  const setSelectedNotebookId = useUIStore((state) => state.setSelectedNotebookId)
  const [isAddingRoot, setIsAddingRoot] = useState(false)
  const [rootName, setRootName] = useState('')

  const { data: notebooks = [] } = useQuery({
    queryKey: ['notebooks'],
    queryFn: notebookService.getTree,
  })

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: tagService.getAll,
  })

  const createNotebookMutation = useMutation({
    mutationFn: (name: string) => notebookService.create({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const createTagMutation = useMutation({
    mutationFn: (name: string) => tagService.create({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })

  const [isAddingTag, setIsAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')

  const handleCreateRoot = () => {
    const trimmed = rootName.trim()
    if (trimmed) {
      createNotebookMutation.mutate(trimmed)
    }
    setIsAddingRoot(false)
    setRootName('')
  }

  const handleCreateTag = () => {
    const trimmed = newTagName.trim()
    if (trimmed) {
      createTagMutation.mutate(trimmed)
    }
    setIsAddingTag(false)
    setNewTagName('')
  }


  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-200 p-4 dark:border-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">笔记本</h2>
          <button
            onClick={() => setIsAddingRoot(true)}
            title="新建笔记本"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="notebook-tree max-h-[40vh] space-y-1 overflow-y-auto">
          {isAddingRoot && (
            <div className="flex items-center gap-2 px-2 py-1.5">
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
                className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1 py-0.5 text-sm outline-none dark:bg-gray-800"
              />
            </div>
          )}
          {notebooks.map((notebook) => (
            <NotebookTreeItem key={notebook.id} notebook={notebook} level={0} />
          ))}
        </div>
      </div>

      <div className="flex-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">标签</h2>
          <button
            onClick={() => setIsAddingTag(true)}
            title="新建标签"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="tag-list flex max-h-[20vh] flex-wrap gap-2 overflow-y-auto">
          {isAddingTag && (
            <input
              autoFocus
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateTag()
                if (e.key === 'Escape') {
                  setIsAddingTag(false)
                  setNewTagName('')
                }
              }}
              onBlur={handleCreateTag}
              placeholder="新标签"
              className="w-24 rounded-full border border-blue-300 bg-white px-2 py-1 text-xs outline-none dark:bg-gray-800"
            />
          )}
          {tags.map((tag) => (
            <TagItem key={tag.id} tag={tag} allTags={tags} />
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 p-4 dark:border-gray-800">
        <button
          onClick={() => {
            setSelectedNotebookId(undefined)
            setSelectedTagId(undefined)
            navigate('/')
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          <Plus size={15} />
          <span>新建笔记</span>
        </button>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setIsAddingRoot(true)}
            className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Folder size={13} />
            <span>笔记本</span>
          </button>
          <button
            onClick={() => setIsAddingTag(true)}
            className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Tag size={13} />
            <span>标签</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
