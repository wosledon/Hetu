import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Folder, Plus, Search, Trash2, Code, BookOpen, Lightbulb, PenTool, MessageSquare } from 'lucide-react'
import { chatGroupService } from '../services/chatService'
import type { IChatGroup } from '../types'

const GROUP_COLORS = ['blue', 'green', 'purple', 'yellow', 'red', 'indigo', 'pink', 'orange', 'teal'] as const
type GroupColor = (typeof GROUP_COLORS)[number]

const GROUP_ICONS: Record<string, React.ElementType> = {
  code: Code,
  book: BookOpen,
  lightbulb: Lightbulb,
  pen: PenTool,
  message: MessageSquare,
  default: Folder,
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function resolveGroupColor(group: IChatGroup): GroupColor {
  const color = group.color?.toLowerCase()
  if (color && GROUP_COLORS.includes(color as GroupColor)) return color as GroupColor
  return GROUP_COLORS[hashString(group.name) % GROUP_COLORS.length]
}

function resolveGroupIcon(group: IChatGroup): React.ElementType {
  const icon = group.icon?.toLowerCase()
  if (icon && GROUP_ICONS[icon]) return GROUP_ICONS[icon]
  return GROUP_ICONS.default
}

interface ChatSidebarProps {
  selectedGroupId?: string
  onSelectGroup: (group: IChatGroup) => void
}

export default function ChatSidebar({ selectedGroupId, onSelectGroup }: ChatSidebarProps) {
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  const createGroup = useMutation({
    mutationFn: chatGroupService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatGroups'] })
      setIsCreating(false)
      setNewGroupName('')
    },
  })

  const deleteGroup = useMutation({
    mutationFn: chatGroupService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatGroups'] })
    },
  })

  const filteredGroups = groups.filter((group) => group.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))

  const handleCreate = () => {
    if (newGroupName.trim()) {
      createGroup.mutate({ name: newGroupName.trim() })
    }
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-200 p-4 dark:border-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">会话组</h2>
          <button
            onClick={() => setIsCreating(true)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
      </div>

      {isCreating && (
        <div className="p-3">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="会话组名称"
            className="w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded bg-transparent"
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCreate}
              className="px-2 py-1 text-xs bg-indigo-600 text-white rounded"
            >
              创建
            </button>
            <button
              onClick={() => setIsCreating(false)}
              className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filteredGroups.map((group) => {
          const color = resolveGroupColor(group)
          const Icon = resolveGroupIcon(group)
          return (
            <div
              key={group.id}
              onClick={() => onSelectGroup(group)}
              className={`group cursor-pointer border-b border-gray-100 p-3 dark:border-gray-800 ${
                selectedGroupId === group.id
                  ? 'bg-blue-50 dark:bg-blue-950/40'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-${color}-500 text-white`}>
                    <Icon size={15} />
                  </div>
                  <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{group.name}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteGroup.mutate(group.id)
                  }}
                  className="rounded p-1 opacity-0 hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
                >
                  <Trash2 size={12} className="text-red-500" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
