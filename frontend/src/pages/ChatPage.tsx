import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import ChatSidebar from '../components/ChatSidebar'
import ChatTopicList from '../components/ChatTopicList'
import ChatTree from '../components/ChatTree'
import ChatMessageArea from '../components/ChatMessageArea'
import { chatGroupService, chatTopicService } from '../services/chatService'
import { useUIStore } from '../stores/uiStore'
import type { IChatGroup, IChatTopic } from '../types'

export default function ChatPage() {
  const [selectedGroup, setSelectedGroup] = useState<IChatGroup | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<IChatTopic | null>(null)
  const secondaryMenuStyle = useUIStore((state) => state.secondaryMenuStyle)
  const collapsed = secondaryMenuStyle === 'collapsed'

  // 获取分组列表，用于自动选择默认分组
  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  // 当前分组下的话题列表，用于渲染常驻 ChatMessageArea
  const { data: topics = [] } = useQuery({
    queryKey: ['chatTopics', selectedGroup?.id],
    queryFn: () => (selectedGroup ? chatTopicService.getByGroup(selectedGroup.id) : Promise.resolve([])),
    enabled: !!selectedGroup,
  })

  // 当分组列表加载完成且没有选择分组时，自动选择第一个分组
  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0])
    }
  }, [groups, selectedGroup])

  // 话题列表加载后自动选第一个
  useEffect(() => {
    if (topics.length > 0 && !selectedTopic) {
      setSelectedTopic(topics[0])
    }
  }, [topics, selectedTopic])

  return (
    <AppLayout showSidebar={false} mainContent={
      <>
        {topics.map((t) => (
          <div key={t.id} style={{ display: t.id === selectedTopic?.id ? 'contents' : 'none' }}>
            <ChatMessageArea topic={t} group={selectedGroup ?? undefined} onTopicUpdated={setSelectedTopic} />
          </div>
        ))}
        {topics.length === 0 && (
          <ChatMessageArea topic={undefined} group={selectedGroup ?? undefined} onTopicUpdated={setSelectedTopic} />
        )}
      </>
    }>
      {collapsed ? (
        <ChatTree
          selectedGroupId={selectedGroup?.id}
          selectedTopicId={selectedTopic?.id}
          onSelectGroup={setSelectedGroup}
          onSelectTopic={setSelectedTopic}
          onDeleteTopic={() => setSelectedTopic(null)}
        />
      ) : (
        <>
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
            onDeleteTopic={() => setSelectedTopic(null)}
          />
        </>
      )}
    </AppLayout>
  )
}
