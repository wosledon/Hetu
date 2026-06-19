import { useState } from 'react'
import AppLayout from '../components/AppLayout'
import ChatSidebar from '../components/ChatSidebar'
import ChatTopicList from '../components/ChatTopicList'
import ChatMessageArea from '../components/ChatMessageArea'
import type { IChatGroup, IChatTopic } from '../types'

export default function ChatPage() {
  const [selectedGroup, setSelectedGroup] = useState<IChatGroup | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<IChatTopic | null>(null)

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
