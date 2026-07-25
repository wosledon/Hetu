import { confirm } from './ConfirmDialog'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Code,
  BookOpen,
  Lightbulb,
  PenTool,
  Folder,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import { chatGroupService, chatTopicService } from '../services/chatService'
import type { IChatGroup, IChatTopic } from '../types'

const GROUP_COLORS = ['blue', 'green', 'purple', 'yellow', 'red', 'indigo', 'pink', 'orange', 'teal'] as const
type GroupColor = (typeof GROUP_COLORS)[number]

const GROUP_COLOR_CLASSES: Record<GroupColor, string> = {
  blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500', yellow: 'bg-yellow-500',
  red: 'bg-red-500', indigo: 'bg-indigo-500', pink: 'bg-pink-500', orange: 'bg-orange-500', teal: 'bg-teal-500',
}

const GROUP_ICONS: Record<string, React.ElementType> = {
  code: Code, book: BookOpen, lightbulb: Lightbulb, pen: PenTool, message: MessageSquare, default: Folder,
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) { hash = (hash << 5) - hash + str.charCodeAt(i); hash |= 0 }
  return Math.abs(hash)
}
function resolveGroupColor(group: IChatGroup): GroupColor {
  const c = group.color?.toLowerCase()
  return (c && GROUP_COLORS.includes(c as GroupColor)) ? (c as GroupColor) : GROUP_COLORS[hashString(group.name) % GROUP_COLORS.length]
}
function resolveGroupIcon(group: IChatGroup): React.ElementType {
  const i = group.icon?.toLowerCase()
  return (i && GROUP_ICONS[i]) ? GROUP_ICONS[i] : GROUP_ICONS.default
}

interface ChatTreeProps {
  selectedGroupId?: string
  selectedTopicId?: string
  onSelectGroup: (group: IChatGroup) => void
  onSelectTopic: (topic: IChatTopic) => void
  onDeleteTopic?: (topicId: string) => void
}

interface TopicMenuState { x: number; y: number; topic: IChatTopic }

function GroupNode({
  group,
  search,
  selectedGroupId,
  selectedTopicId,
  onSelectGroup,
  onSelectTopic,
  onOpenTopicMenu,
}: {
  group: IChatGroup
  search: string
  selectedGroupId?: string
  selectedTopicId?: string
  onSelectGroup: (group: IChatGroup) => void
  onSelectTopic: (topic: IChatTopic) => void
  onOpenTopicMenu: (e: React.MouseEvent, topic: IChatTopic) => void
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  // 组仅在"被选为当前组但尚未选中具体话题"时聚焦；一旦选中话题，焦点移到叶子节点
  const isGroupFocused = selectedGroupId === group.id && !selectedTopicId
  const color = resolveGroupColor(group)
  const Icon = resolveGroupIcon(group)

  // 当前话题属于本组时，自动展开以露出高亮的话题
  useEffect(() => {
    if (selectedTopicId && selectedGroupId === group.id) setExpanded(true)
  }, [selectedTopicId, selectedGroupId, group.id])

  const { data: topics = [] } = useQuery({
    queryKey: ['chatTopics', group.id],
    queryFn: () => chatTopicService.getByGroup(group.id),
    enabled: expanded,
  })
  const filtered = topics.filter((t) => !search || t.title.toLowerCase().includes(search))

  const createTopic = useMutation({
    mutationFn: chatTopicService.create,
    onSuccess: (newTopic) => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics', group.id] })
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      onSelectGroup(group)
      onSelectTopic(newTopic)
    },
  })

  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
          isGroupFocused ? 'bg-gray-100/70 dark:bg-white/[0.06]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
        }`}
        onClick={() => { onSelectGroup(group); setExpanded(true) }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className="shrink-0 text-gray-400"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-white ${GROUP_COLOR_CLASSES[color]}`}>
          <Icon size={11} />
        </div>
        <span className={`min-w-0 flex-1 truncate text-sm ${isGroupFocused ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'}`}>
          {group.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(true); createTopic.mutate({ groupId: group.id, title: '' }) }}
          title="新建话题"
          className="rounded p-0.5 text-gray-300 opacity-0 transition-all hover:bg-gray-100 hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-gray-700"
        >
          <Plus size={13} />
        </button>
      </div>

      {expanded && (
        <div>
          {filtered.map((topic) => {
            const active = selectedTopicId === topic.id
            return (
              <div
                key={topic.id}
                onClick={() => { onSelectGroup(group); onSelectTopic(topic) }}
                onContextMenu={(e) => { e.preventDefault(); onOpenTopicMenu(e, topic) }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
                  active ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                }`}
                style={{ paddingLeft: '42px' }}
              >
                <MessageSquare size={12} className={`shrink-0 ${active ? 'text-blue-500' : 'text-gray-400'}`} />
                <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-300'}`}>
                  {topic.title || '新话题'}
                </span>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="py-1 text-[11px] text-gray-300 dark:text-gray-600" style={{ paddingLeft: '42px' }}>空</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChatTree({ selectedGroupId, selectedTopicId, onSelectGroup, onSelectTopic, onDeleteTopic }: ChatTreeProps) {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [topicMenu, setTopicMenu] = useState<TopicMenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [isAddingGroup, setIsAddingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')

  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  const search = searchTerm.trim().toLowerCase()
  const filteredGroups = groups.filter((g) => !search || g.name.toLowerCase().includes(search))

  const closeTopicMenu = () => setTopicMenu(null)

  const createGroup = useMutation({
    mutationFn: chatGroupService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatGroups'] })
      setIsAddingGroup(false)
      setGroupName('')
    },
  })

  const handleCreateGroup = () => {
    const trimmed = groupName.trim()
    if (trimmed) createGroup.mutate({ name: trimmed })
    else { setIsAddingGroup(false); setGroupName('') }
  }

  const deleteTopic = useMutation({
    mutationFn: chatTopicService.delete,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      onDeleteTopic?.(id)
      closeTopicMenu()
    },
  })

  const renameTopic = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => chatTopicService.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      setRenamingId(null)
      closeTopicMenu()
    },
  })

  const submitRename = () => {
    if (renamingId && renameText.trim()) renameTopic.mutate({ id: renamingId, title: renameText.trim() })
    else setRenamingId(null)
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-3 dark:border-gray-800">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">会话</h2>
          <button
            onClick={() => setIsAddingGroup(true)}
            title="新建会话组"
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
            className="w-full rounded-lg border border-gray-200/80 bg-gray-50/80 py-1.5 pl-7 pr-2 text-[13px] outline-none transition-all placeholder:text-gray-400 focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:focus:border-blue-600"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isAddingGroup && (
          <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5">
            <Folder size={14} className="shrink-0 text-blue-500" />
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateGroup()
                if (e.key === 'Escape') { setIsAddingGroup(false); setGroupName('') }
              }}
              onBlur={handleCreateGroup}
              placeholder="会话组名称"
              className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[13px] outline-none dark:bg-gray-800"
            />
          </div>
        )}
        {filteredGroups.map((group) => (
          <GroupNode
            key={group.id}
            group={group}
            search={search}
            selectedGroupId={selectedGroupId}
            selectedTopicId={selectedTopicId}
            onSelectGroup={onSelectGroup}
            onSelectTopic={onSelectTopic}
            onOpenTopicMenu={(e, topic) => setTopicMenu({ x: e.clientX, y: e.clientY, topic })}
          />
        ))}
        {filteredGroups.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400">暂无会话组</div>
        )}
      </div>

      {topicMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={closeTopicMenu} onContextMenu={(e) => { e.preventDefault(); closeTopicMenu() }} />
          <div
            className="fixed z-[9999] min-w-[150px] overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
            style={{ left: Math.min(topicMenu.x, window.innerWidth - 170), top: Math.min(topicMenu.y, window.innerHeight - 140) }}
          >
            {renamingId === topicMenu.topic.id ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                  className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-1 text-xs outline-none dark:bg-gray-900"
                />
                <button onClick={submitRename} className="p-1 text-emerald-500"><Check size={13} /></button>
                <button onClick={() => setRenamingId(null)} className="p-1 text-gray-400"><X size={13} /></button>
              </div>
            ) : (
              <button
                onClick={() => { setRenamingId(topicMenu.topic.id); setRenameText(topicMenu.topic.title) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <Pencil size={13} />
                重命名
              </button>
            )}
            <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
            <button
              onClick={() => { closeTopicMenu(); confirm({ message: '确定删除这个话题吗？', onConfirm: () => deleteTopic.mutate(topicMenu.topic.id) }) }}
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
