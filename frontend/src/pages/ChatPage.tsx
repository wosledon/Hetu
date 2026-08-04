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
  const [selectedMain, setSelectedMain] = useState(false)
  const secondaryMenuStyle = useUIStore((state) => state.secondaryMenuStyle)
  const collapsed = secondaryMenuStyle === 'collapsed'

  // 主对话（全局主对话组 + 唯一主话题）
  const { data: mainChat } = useQuery({
    queryKey: ['chatMain'],
    queryFn: chatGroupService.getMain,
  })

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

  const handleSelectMain = () => {
    if (!mainChat) return
    setSelectedGroup(mainChat.group)
    setSelectedTopic(mainChat.topic)
    setSelectedMain(true)
  }

  const handleSelectGroup = (group: IChatGroup) => {
    setSelectedGroup(group)
    setSelectedTopic(null)
    setSelectedMain(false)
  }

  const handleSelectTopic = (topic: IChatTopic) => {
    setSelectedTopic(topic)
    setSelectedMain(topic.id === mainChat?.topic.id)
  }

  // 主对话存在时默认选中主对话；否则选第一个分组
  useEffect(() => {
    if (selectedGroup) return
    if (mainChat) {
      handleSelectMain()
    } else if (groups.length > 0) {
      setSelectedGroup(groups[0])
    }
  }, [groups, mainChat, selectedGroup])

  // 话题列表加载后自动选第一个
  useEffect(() => {
    if (topics.length > 0 && !selectedTopic && !selectedMain) {
      setSelectedTopic(topics[0])
    }
  }, [topics, selectedTopic, selectedMain])

  return (
    <AppLayout showSidebar={false} mainContent={
      selectedTopic ? (
        <ChatMessageArea
          key={selectedTopic.id}
          topic={selectedTopic}
          group={selectedGroup ?? undefined}
          onTopicUpdated={setSelectedTopic}
        />
      ) : (
        <ChatMessageArea topic={undefined} group={selectedGroup ?? undefined} onTopicUpdated={setSelectedTopic} />
      )
    }>
      {collapsed ? (
        <ChatTree
          mainChat={mainChat}
          selectedMain={selectedMain}
          selectedGroupId={selectedGroup?.id}
          selectedTopicId={selectedTopic?.id}
          onSelectGroup={handleSelectGroup}
          onSelectTopic={handleSelectTopic}
          onSelectMain={handleSelectMain}
          onDeleteTopic={() => setSelectedTopic(null)}
        />
      ) : (
        <>
          <ChatSidebar
            mainChat={mainChat}
            selectedMain={selectedMain}
            selectedGroupId={selectedGroup?.id}
            onSelectGroup={handleSelectGroup}
            onSelectMain={handleSelectMain}
          />
          <ChatTopicList
            groupId={selectedGroup?.id}
            isMainGroup={selectedMain}
            selectedTopicId={selectedTopic?.id}
            onSelectTopic={handleSelectTopic}
            onDeleteTopic={() => setSelectedTopic(null)}
          />
        </>
      )}
    </AppLayout>
  )
}
