import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Search, X, Pencil, Check } from 'lucide-react'
import { chatTopicService } from '../services/chatService'
import type { IChatTopic } from '../types'
import Select from './Select'

type SortKey = 'updated' | 'created'

interface ChatTopicListProps {
  groupId?: string
  selectedTopicId?: string
  onSelectTopic: (topic: IChatTopic) => void
  onDeleteTopic?: (topicId: string) => void
}

export default function ChatTopicList({ groupId, selectedTopicId, onSelectTopic, onDeleteTopic }: ChatTopicListProps) {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')

  const { data: topics = [] } = useQuery({
    queryKey: ['chatTopics', groupId],
    queryFn: () => (groupId ? chatTopicService.getByGroup(groupId) : Promise.resolve([])),
    enabled: !!groupId,
  })

  const filteredTopics = useMemo(() => {
    if (!searchQuery.trim()) return topics
    const query = searchQuery.toLowerCase()
    return topics.filter(t => t.title.toLowerCase().includes(query))
  }, [topics, searchQuery])

  const createTopic = useMutation({
    mutationFn: chatTopicService.create,
    onSuccess: (newTopic) => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics', groupId] })
      onSelectTopic(newTopic)
    },
  })

  const deleteTopic = useMutation({
    mutationFn: chatTopicService.delete,
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics', groupId] })
      if (deletedId === selectedTopicId) {
        onDeleteTopic?.(deletedId)
      }
    },
  })

  const updateTopic = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      chatTopicService.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics', groupId] })
      setEditingTopicId(null)
      setEditingTitle('')
    },
  })

  const handleCreate = () => {
    if (groupId) {
      createTopic.mutate({ groupId, title: '' })
    }
  }

  // 当话题列表加载完成且没有选择话题时，自动选择第一个话题
  useEffect(() => {
    if (topics.length > 0 && !selectedTopicId) {
      onSelectTopic(topics[0])
    }
  }, [topics, selectedTopicId])

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">话题</h2>
          <div className="flex items-center gap-1">
            {groupId && (
              <button
                onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery('') }}
                className={`rounded-lg p-1.5 transition-colors ${showSearch ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'}`}
                title="搜索话题"
              >
                <Search size={14} />
              </button>
            )}
            {groupId && (
              <button
                onClick={handleCreate}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                title="新建话题"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>
        <Select
          value={sortKey}
          onChange={(value) => setSortKey(value as SortKey)}
          options={[
            { value: 'updated', label: '最新更新' },
            { value: 'created', label: '创建时间' },
          ]}
        />
      </div>

      {showSearch && (
        <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索话题..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-7 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:placeholder:text-gray-500"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {filteredTopics.length === 0 && searchQuery && (
          <div className="py-8 text-center text-xs text-gray-400">未找到匹配的话题</div>
        )}
        {filteredTopics.length === 0 && !searchQuery && groupId && (
          <div className="py-8 text-center text-xs text-gray-400">暂无话题，点击 + 创建</div>
        )}
        {filteredTopics.map((topic) => (
          <div
            key={topic.id}
            onClick={() => onSelectTopic(topic)}
            className={`group mb-0.5 cursor-pointer rounded-xl p-3 transition-colors ${
              selectedTopicId === topic.id
                ? 'bg-blue-50 dark:bg-blue-950/40'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }`}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              {editingTopicId === topic.id ? (
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter' && editingTitle.trim()) {
                        updateTopic.mutate({ id: topic.id, title: editingTitle.trim() })
                      } else if (e.key === 'Escape') {
                        setEditingTopicId(null)
                        setEditingTitle('')
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800"
                    autoFocus
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (editingTitle.trim()) {
                        updateTopic.mutate({ id: topic.id, title: editingTitle.trim() })
                      }
                    }}
                    className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingTopicId(null)
                      setEditingTitle('')
                    }}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <h3 className={`flex-1 line-clamp-1 text-sm ${selectedTopicId === topic.id ? 'font-medium text-blue-700 dark:text-blue-200' : 'font-medium text-gray-700 dark:text-gray-200'}`}>{topic.title || '新话题'}</h3>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingTopicId(topic.id)
                        setEditingTitle(topic.title)
                      }}
                      className="rounded-lg p-1 hover:bg-gray-200 dark:hover:bg-gray-700"
                      title="重命名"
                    >
                      <Pencil size={12} className="text-gray-500" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteTopic.mutate(topic.id)
                      }}
                      className="rounded-lg p-1 hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      <Trash2 size={12} className="text-red-400" />
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span className={`rounded px-1.5 py-0.5 ${
                topic.noteSyncStatus === 'synced'
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : topic.noteSyncStatus === 'outdated'
                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
              }`}>
                {topic.noteSyncStatus === 'synced' ? '已整理' : topic.noteSyncStatus === 'outdated' ? '已变更' : '待整理'}
              </span>
              <span>{new Date(topic.updatedAt).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
