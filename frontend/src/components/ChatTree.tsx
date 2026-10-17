import { confirm } from './confirm'
import { forwardRef, useImperativeHandle, useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MessageSquare,
  Plus,
  Trash2,
  Code,
  BookOpen,
  Lightbulb,
  PenTool,
  Folder,
  Pencil,
} from 'lucide-react'
import { chatGroupService, chatTopicService } from '../services/chatService'
import { useTranslation } from 'react-i18next'
import MainChatEntry from './MainChatEntry'
import { Card, ContextMenu, IconButton, Input, TreeRow } from './ui'
import type { IChatGroup, IChatTopic, IMainChat } from '../types'

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
function resolveGroupIconKey(group: IChatGroup): string {
  const i = group.icon?.toLowerCase()
  return (i && GROUP_ICONS[i]) ? i : 'default'
}

interface ChatTreeProps {
  mainChat?: IMainChat
  selectedMain?: boolean
  selectedGroupId?: string
  selectedTopicId?: string
  onSelectGroup: (group: IChatGroup) => void
  onSelectTopic: (topic: IChatTopic) => void
  onSelectMain?: () => void
  onDeleteTopic?: (topicId: string) => void
  /** 删除会话组：组内话题会级联删除，父级借此清理停在已删组上的选择 */
  onDeleteGroup?: (groupId: string) => void
  /** 嵌在合并侧栏里：不占固定宽度、不画右边框 */
  embedded?: boolean
  /** 搜索词由一级菜单输入框提供 */
  search?: string
  /** 主对话已由外层置顶渲染时隐藏卡片 */
  hideMainChat?: boolean
  /** 新建话题：只放草稿占位（第一条消息才落库） */
  onStartDraftTopic?: (group: IChatGroup) => void
}

function GroupNode({
  group,
  search,
  selectedGroupId,
  selectedTopicId,
  onSelectGroup,
  onSelectTopic,
  onDeleteTopic,
  onDeleteGroup,
  onStartDraftTopic,
}: {
  group: IChatGroup
  search: string
  selectedGroupId?: string
  selectedTopicId?: string
  onSelectGroup: (group: IChatGroup) => void
  onSelectTopic: (topic: IChatTopic) => void
  onDeleteTopic?: (topicId: string) => void
  /** 删除会话组：组内话题会级联删除，父级借此清理停在已删组上的选择 */
  onDeleteGroup?: (groupId: string) => void
  /** 新建话题：只放草稿占位（第一条消息才落库） */
  onStartDraftTopic?: (group: IChatGroup) => void
}) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('chat')
  const [expandedOverride, setExpandedOverride] = useState<{ key: string | null; expanded: boolean } | null>(null)
  // 组仅在"被选为当前组但尚未选中具体话题"时聚焦；一旦选中话题，焦点移到叶子节点
  const isGroupFocused = selectedGroupId === group.id && !selectedTopicId
  const color = resolveGroupColor(group)
  const iconKey = resolveGroupIconKey(group)
  const Icon = GROUP_ICONS[iconKey]

  // 选中本组话题时自动展开；用户手动切换后以 override 为准（焦点变化后失效）
  const focusKey = selectedGroupId === group.id ? selectedTopicId ?? null : null
  const expanded = expandedOverride?.key === focusKey ? expandedOverride.expanded : focusKey !== null
  const setExpanded = (value: boolean) => setExpandedOverride({ key: focusKey, expanded: value })

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

  // 删组会级联删掉组内话题与消息（EF 侧 Cascade），确认文案里要说清
  const deleteGroup = useMutation({
    mutationFn: chatGroupService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatGroups'] })
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      onDeleteGroup?.(group.id)
    },
  })

  // 话题的重命名 / 删除挂在右键菜单上（与项目行一致），行内只留选中态
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; topicId: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const menuTopic = filtered.find((item) => item.id === menu?.topicId)

  const deleteTopic = useMutation({
    mutationFn: chatTopicService.delete,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      onDeleteTopic?.(id)
    },
  })

  const renameTopic = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => chatTopicService.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics'] })
      setRenamingId(null)
    },
  })

  const submitRename = () => {
    if (renamingId && renameText.trim()) renameTopic.mutate({ id: renamingId, title: renameText.trim() })
    else setRenamingId(null)
  }

  return (
    <div>
      <TreeRow
        expandable
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        selected={isGroupFocused}
        icon={(
          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-white ${GROUP_COLOR_CLASSES[color]}`}>
            <Icon size={11} />
          </div>
        )}
        label={group.name}
        onClick={() => { onSelectGroup(group); setExpanded(true) }}
        actions={
          <IconButton variant="ghost" tone="gray" className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700" label={t('tree.deleteGroup')} onClick={(e) => {
            e.stopPropagation()
            confirm({
              message: t('tree.deleteGroupConfirm', { name: group.name }),
              onConfirm: () => deleteGroup.mutate(group.id),
            })
          }}
            title={t('tree.deleteGroup')}
            aria-label={t('tree.deleteGroup')}>
            <Trash2 size={11} />
          </IconButton>
        }
      />

      {expanded && (
        <div>
          {filtered.map((topic) => {
            const active = selectedTopicId === topic.id
            return (
              <TreeRow
                key={topic.id}
                depth={1}
                selected={active}
                onClick={() => { onSelectGroup(group); onSelectTopic(topic) }}
                icon={(activeIcon) => <MessageSquare size={12} className={`shrink-0 ${activeIcon ? 'text-blue-500' : 'text-gray-400'}`} />}
                label={renamingId === topic.id ? (
                  <Input
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1 py-0.5 text-[12px] outline-none dark:bg-gray-800"
                  />
                ) : (topic.title || t('tree.newTopicFallback'))}
                labelClassName="text-gray-600 dark:text-gray-300"
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ x: e.clientX, y: e.clientY, topicId: topic.id })
                }}
              />
            )
          })}

          {/* 话题操作收进右键菜单：与项目行一致，行内只留选中态 */}
          <ContextMenu
            anchor={menu}
            onClose={closeMenu}
            items={[
              {
                key: 'rename',
                label: t('common:rename'),
                icon: <Pencil size={14} />,
                onSelect: () => { setRenamingId(menuTopic!.id); setRenameText(menuTopic!.title) },
              },
              {
                key: 'delete',
                label: t('common:delete'),
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: () => confirm({ message: t('tree.deleteConfirm'), onConfirm: () => deleteTopic.mutate(menuTopic!.id) }),
              },
            ]}
          />

          {/* 空组不占位：下面的「新建话题」行已经说明该组还没有话题 */}
          {/* 与 Code 的「新会话」一致：新建入口放在列表下面，不占组行右侧 */}
          <TreeRow
            depth={1}
            icon={<Plus size={12} className="shrink-0" />}
            label={t('tree.newTopic')}
            labelClassName="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400"
            onClick={() => {
              setExpanded(true)
              if (onStartDraftTopic) onStartDraftTopic(group)
              else createTopic.mutate({ groupId: group.id, title: '' })
            }}
          />
        </div>
      )}
    </div>
  )
}

export interface ChatTreeHandle {
  /** 一级菜单的「＋」触发：在列表顶部展开新建会话组输入 */
  startCreateGroup: () => void
}

const ChatTree = forwardRef<ChatTreeHandle, ChatTreeProps>(function ChatTree({
  mainChat, selectedMain, selectedGroupId, selectedTopicId, onSelectGroup, onSelectTopic, onSelectMain,
  onDeleteTopic, onDeleteGroup, embedded, search = '', hideMainChat, onStartDraftTopic,
}, ref) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('chat')
  const [isAddingGroup, setIsAddingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')

  useImperativeHandle(ref, () => ({ startCreateGroup: () => setIsAddingGroup(true) }), [])

  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  const keyword = search.trim().toLowerCase()
  const filteredGroups = groups.filter((g) => !keyword || g.name.toLowerCase().includes(keyword))

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

  const treeBody = (
    <div className="flex-1 overflow-y-auto p-2">
      {mainChat && !hideMainChat && (
        <>
          <div className="mb-1.5">
            <MainChatEntry mainChat={mainChat} selected={selectedMain} onSelect={onSelectMain} />
          </div>
          <div className="my-1.5 border-t border-gray-200 dark:border-gray-800" />
        </>
      )}
      {isAddingGroup && (
        <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5">
          <Folder size={14} className="shrink-0 text-blue-500" />
          <Input
            autoFocus
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateGroup()
              if (e.key === 'Escape') { setIsAddingGroup(false); setGroupName('') }
            }}
            onBlur={handleCreateGroup}
            placeholder={t('tree.groupNamePlaceholder')}
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
          onDeleteTopic={onDeleteTopic}
          onDeleteGroup={onDeleteGroup}
          onStartDraftTopic={onStartDraftTopic}
        />
      ))}
      {filteredGroups.length === 0 && (
        <div className="py-8 text-center text-xs text-gray-400">{t('tree.noGroups')}</div>
      )}
    </div>
  )

  // embedded：已被外层卡片（Code 页左栏）包住，不再自带卡片材质，否则是一张卡套一张卡
  if (embedded) {
    return <div className="flex min-h-0 w-full flex-1 flex-col">{treeBody}</div>
  }

  return (
    <Card padded={false} className="flex w-64 shrink-0 flex-col border-r">
      {treeBody}
    </Card>
  )
})

export default ChatTree
