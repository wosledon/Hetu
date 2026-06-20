import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Folder, Plus, Search, Trash2, Code, BookOpen, Lightbulb, PenTool, MessageSquare } from 'lucide-react'
import { chatGroupService } from '../services/chatService'
import type { IChatGroup } from '../types'

const GROUP_COLORS = ['blue', 'green', 'purple', 'yellow', 'red', 'indigo', 'pink', 'orange', 'teal'] as const
type GroupColor = (typeof GROUP_COLORS)[number]

// Tailwind 不支持动态类名拼接，需要预先定义完整的类名
const GROUP_COLOR_CLASSES: Record<GroupColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  indigo: 'bg-indigo-500',
  pink: 'bg-pink-500',
  orange: 'bg-orange-500',
  teal: 'bg-teal-500',
}

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
    <div className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">会话组</h2>
          <button
            onClick={() => setIsCreating(true)}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
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
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500 dark:focus:border-blue-600 dark:focus:bg-gray-800"
          />
        </div>
      </div>

      {isCreating && (
        <div className="border-b border-gray-100 p-3 dark:border-gray-800">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="会话组名称"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleCreate}
              className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
            >
              创建
            </button>
            <button
              onClick={() => setIsCreating(false)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {filteredGroups.map((group) => {
          const color = resolveGroupColor(group)
          const Icon = resolveGroupIcon(group)
          return (
            <div
              key={group.id}
              onClick={() => onSelectGroup(group)}
              className={`group mb-0.5 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                selectedGroupId === group.id
                  ? 'bg-blue-50 dark:bg-blue-950/40'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${GROUP_COLOR_CLASSES[color]}`}>
                <Icon size={14} />
              </div>
              <span className={`flex-1 truncate text-sm ${selectedGroupId === group.id ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>{group.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteGroup.mutate(group.id)
                }}
                className="rounded-lg p-1 opacity-0 transition-all hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
              >
                <Trash2 size={12} className="text-red-400" />
              </button>
            </div>
          )
        })}
        {filteredGroups.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400">暂无会话组</div>
        )}
      </div>
    </div>
  )
}
