import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import ChatSidebar from '../components/ChatSidebar'
import ChatTopicList from '../components/ChatTopicList'
import ChatMessageArea from '../components/ChatMessageArea'
import { chatGroupService } from '../services/chatService'
import type { IChatGroup, IChatTopic } from '../types'

export default function ChatPage() {
  const [selectedGroup, setSelectedGroup] = useState<IChatGroup | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<IChatTopic | null>(null)

  // 获取分组列表，用于自动选择默认分组
  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  // 当分组列表加载完成且没有选择分组时，自动选择第一个分组
  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0])
    }
  }, [groups, selectedGroup])

  return (
    <AppLayout showSidebar={false} mainContent={<ChatMessageArea topic={selectedTopic ?? undefined} group={selectedGroup ?? undefined} onTopicUpdated={setSelectedTopic} />}>
      <ChatSidebar
        selectedGroupId={selectedGroup?.id}
        onSelectGroup={(group) => {
          setSelectedGroup(group)
          setSelectedTopic(null)
        }}
      />
      <ChatTopicList
        groupId={selectedGroup?.id}
        selectedTopicId={selectedTopic?.id}
        onSelectTopic={setSelectedTopic}
      />
    </AppLayout>
  )
}
