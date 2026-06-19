import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Search, X } from 'lucide-react'
import { chatTopicService } from '../services/chatService'
import type { IChatTopic } from '../types'

interface ChatTopicListProps {
  groupId?: string
  selectedTopicId?: string
  onSelectTopic: (topic: IChatTopic) => void
}

export default function ChatTopicList({ groupId, selectedTopicId, onSelectTopic }: ChatTopicListProps) {
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [newTopicTitle, setNewTopicTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics', groupId] })
      setIsCreating(false)
      setNewTopicTitle('')
    },
  })

  const deleteTopic = useMutation({
    mutationFn: chatTopicService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatTopics', groupId] })
    },
  })

  const handleCreate = () => {
    if (newTopicTitle.trim() && groupId) {
      createTopic.mutate({ groupId, title: newTopicTitle.trim() })
    }
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-200 p-4 dark:border-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">话题</h2>
          <div className="flex items-center gap-1">
            {groupId && (
              <button
                onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery('') }}
                className={`rounded p-1 text-gray-500 ${showSearch ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                title="搜索话题"
              >
                <Search size={14} />
              </button>
            )}
            {groupId && (
              <button
                onClick={() => setIsCreating(true)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>
        <select className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-900">
          <option>最新更新</option>
          <option>创建时间</option>
        </select>
      </div>

      {showSearch && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索话题..."
              className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-transparent outline-none focus:border-indigo-400"
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

      {isCreating && (
        <div className="p-3">
          <input
            type="text"
            value={newTopicTitle}
            onChange={(e) => setNewTopicTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="话题标题"
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
        {filteredTopics.length === 0 && searchQuery && (
          <div className="p-3 text-sm text-gray-500 text-center">未找到匹配的话题</div>
        )}
        {filteredTopics.map((topic) => (
          <div
            key={topic.id}
            onClick={() => onSelectTopic(topic)}
            className={`group cursor-pointer border-b border-gray-100 p-3 dark:border-gray-800 ${
              selectedTopicId === topic.id
                ? 'bg-blue-50 dark:bg-blue-950/40'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }`}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 text-sm font-medium text-gray-800 dark:text-gray-100">{topic.title}</h3>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteTopic.mutate(topic.id)
                }}
                className="rounded p-1 opacity-0 hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
              >
                <Trash2 size={12} className="text-red-500" />
              </button>
            </div>
            <p className="mb-2 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">点击进入对话，继续围绕该话题提问和整理内容...</p>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{topic.isArchived ? '已归档' : '进行中'}</span>
              <span>{new Date(topic.updatedAt).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
